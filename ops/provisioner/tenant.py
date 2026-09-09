#!/usr/bin/env python3
"""Isolated BookStack tenant lifecycle. Never prints subprocess output or secrets."""
import signal, hashlib, hmac, datetime, pty, select, termios
import base64, contextlib, fcntl, json, os, re, secrets, shlex, shutil, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
ROOT = Path('/home/flori/ventures2/bookstack/tenants')
HERE = Path(__file__).resolve().parent
IMAGE = 'lscr.io/linuxserver/bookstack:v26.05.4-ls283'
DB_IMAGE = 'mariadb:11.4@sha256:611a2fcc5fa7c6ceb8644c6f74b25ede004ff6c3a6b38c8f8c23d3bbf6c26430'
os.umask(0o077)
KEY = Path('/home/flori/ventures2/bookstack/work/.backup.key')
RESERVED = set(json.loads((HERE/'reserved-slugs.json').read_text()))

def valid_slug(slug):
    return bool(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])', slug)) and '--' not in slug and not slug.startswith('restore') and slug not in RESERVED


def run(args, data=None):
    p = subprocess.run(['timeout','--foreground','--kill-after=10s','180s',*args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode: raise RuntimeError('Command failed: ' + ' '.join(args[:4]))
    return p.stdout

def env_read(path):
    values = {}
    for line in path.read_text().splitlines():
        parts = shlex.split(line, comments=True)
        if parts and parts[0] == 'export': parts.pop(0)
        if not parts: continue
        if len(parts) != 1 or '=' not in parts[0]: raise ValueError('Unsupported env syntax')
        key, value = parts[0].split('=',1); values[key] = value
    return values

def compose(path, *args, data=None):
    return run(['sudo','-n','docker','compose','--project-directory',str(path),'-p','wissen-'+path.name,'-f',str(path/'docker-compose.yml'),*args], data)

def config(path, public=True):
    slug = path.name; host = slug+'.wissen.app.mintapis.com'; router='wissen-'+slug
    app = dict(image=IMAGE, restart='unless-stopped', mem_limit='512m', environment={'PUID':'1000','PGID':'1000','TZ':'UTC','APP_URL':'${APP_URL}','APP_KEY':'${APP_KEY}','DB_HOST':'db','DB_PORT':'3306','DB_USERNAME':'bookstack','DB_PASSWORD':'${DB_PASSWORD}','DB_DATABASE':'bookstack'}, volumes=['./bookstack:/config'], depends_on={'db':{'condition':'service_healthy'}}, networks=['private'])
    db = dict(image=DB_IMAGE, restart='unless-stopped',mem_limit='512m', environment={'MARIADB_DATABASE':'bookstack','MARIADB_USER':'bookstack','MARIADB_PASSWORD':'${DB_PASSWORD}','MARIADB_ROOT_PASSWORD':'${DB_ROOT_PASSWORD}'},volumes=['./database:/var/lib/mysql'],networks=['private'],healthcheck={'test':['CMD','healthcheck.sh','--connect','--innodb_initialized'],'interval':'5s','timeout':'5s','retries':60}, command=['--innodb-buffer-pool-size=128M','--max-connections=50'])
    networks = {'private':{'name':router+'-internal','internal':True}}
    if public:
        app['networks'].append('coolify'); networks['coolify']={'external':True,'name':'coolify'}
        labels={'traefik.enable':'true','traefik.docker.network':'coolify',f'traefik.http.services.{router}.loadbalancer.server.port':'80',f'traefik.http.middlewares.{router}-redirect.redirectscheme.scheme':'https'}
        for scheme in ['http','https']:
            prefix=f'traefik.http.routers.{router}-{scheme}'
            labels.update({prefix+'.rule':f'Host(`{host}`)',prefix+'.entrypoints':scheme,prefix+'.service':router})
            if scheme=='https': labels.update({prefix+'.tls':'true',prefix+'.tls.certresolver':'letsencrypt'})
            else: labels[prefix+'.middlewares']=router+'-redirect'
        app['labels']=labels
    else: app['labels']={'traefik.enable':'false'}
    document={'services':{'bookstack':app,'db':db},'networks':networks}
    harden_network(document, slug, public)
    (path/'docker-compose.yml').write_text(json.dumps(document,indent=2)+'\n')

def harden_network(document, slug, public=True):
    """Only the app joins the proxy bridge; never modify the shared bridge."""
    document['networks']={'private':{'name':'wissen-'+slug+'-internal','internal':True}}
    if public:
        document['networks']['coolify']={'external':True,'name':'coolify'}
    for name in ('bookstack','db'):
        service=document['services'][name]
        service['networks']=['private'] + (['coolify'] if name=='bookstack' and public else [])
        service.pop('network_mode',None)
        service.pop('ports',None)
        service.pop('cap_add',None)
        service['privileged']=False
        options=[v for v in service.get('security_opt',[]) if not v.startswith('no-new-privileges')]
        service['security_opt']=options+['no-new-privileges:true']
        labels=service.setdefault('labels',{})
        labels['com.wissen.tenant']=slug
        labels['com.wissen.isolation']='private-database-shared-proxy'
        if name=='db' or not public: labels['traefik.enable']='false'
        else: labels['traefik.docker.network']='coolify'


def migrate_network(path):
    """Preserve credentials, data, images and app settings; rollback on failure."""
    if not (path/'.initialized').exists():
        raise ValueError('Network migration requires an initialized tenant')
    target=path/'docker-compose.yml'
    original=target.read_bytes()
    document=json.loads(original)
    harden_network(document,path.name)
    # Validate without stopping the tenant or exposing resolved secrets.
    candidate=path/'.network-candidate.json'
    candidate.write_text(json.dumps(document,indent=2)+'\n')
    try:
        run(['sudo','-n','docker','compose','--project-directory',str(path),
             '-f',str(candidate),'config','--quiet'])
    finally:
        candidate.unlink(missing_ok=True)
    expected=content(path)
    started=time.monotonic()
    try:
        compose(path,'down','--remove-orphans')
        target.write_text(json.dumps(document,indent=2)+'\n')
        compose(path,'up','-d')
        ready_internal(path)
        public_ready(env_read(path/'.env')['APP_URL'])
        if content(path)!=expected: raise RuntimeError('Content changed during migration')
    except BaseException:
        # Remove the new network before restoring the old Compose definition.
        try: compose(path,'down','--remove-orphans')
        finally:
            target.write_bytes(original)
            compose(path,'up','-d')
        raise
    print('MIGRATED '+path.name+' pages='+expected['pages']+' elapsed_seconds='+str(round(time.monotonic()-started,1)))


def php(path, code, payload=None):
    # Payload passes only through stdin, never argv or Docker environment metadata.
    script="require '/app/www/vendor/autoload.php'; $app=require '/app/www/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); "+code
    return compose(path,'exec','-T','-u','1000:1000','-w','/app/www','bookstack','php','-r',script,data=json.dumps(payload or {}).encode())

def ready_internal(path):
    for _ in range(120):
        try:
            php(path,"$m=app('migrator'); $pending=array_diff(array_keys($m->getMigrationFiles(database_path('migrations'))),$m->getRepository()->getRan()); if(count($pending)) {exit(1);} echo 'ready';")
            return
        except RuntimeError: time.sleep(5)
    raise RuntimeError('BookStack initialization timed out')

def public_ready(url):
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url+'/login',timeout=10) as r:
                body=r.read()
                if r.status==200 and (b'BookStack' in body or (b'name="_token"' in body and b'/login"' in body)): return
        except Exception: pass
        time.sleep(5)
    raise RuntimeError('HTTPS login readiness timed out')

def seed_starter_book(path, email):
    """Safe to repeat during initial bootstrap; never called by resume."""
    php(path, r'''
$v=json_decode(stream_get_contents(STDIN),true);
auth()->setUser(BookStack\Users\Models\User::where('email',$v['email'])->firstOrFail());
Illuminate\Support\Facades\DB::transaction(function() {
$b=BookStack\Entities\Models\Book::where('name','Team handbook')->first();
if (!$b) $b=app(BookStack\Entities\Repos\BookRepo::class)->create(['name'=>'Team handbook','description'=>'A home for your team knowledge.']);
if (!$b->pages()->where('name','How to use this wiki')->exists()) {
$repo=app(BookStack\Entities\Repos\PageRepo::class);
$draft=$repo->getNewDraftPage($b);
$repo->publishDraft($draft,['name'=>'How to use this wiki','editor'=>'wysiwyg','html'=>'<h1>Welcome to your team wiki</h1><p>Keep useful knowledge here and update it as your team learns.</p><h2>Books, chapters and pages</h2><p>Books group a topic, optional chapters organize sections, and pages hold the actual content. Edit this handbook or create a book for each project.</p><h2>Roles and access</h2><p>Ask your workspace administrator to invite teammates and assign BookStack roles. Check book permissions before adding sensitive information.</p><h2>Find answers</h2><p>Use the search bar to find pages across the books you can access. Clear titles and tags help everyone find answers.</p><h2>Document intake in Wissen</h2><p>Open Document intake in your Wissen dashboard, upload a PDF, DOCX, Markdown or text file, and choose a book. Review the AI suggestion against the source. A team owner or admin approves publication; uploaded documents are not published automatically.</p>']);
}
});
''', {'email': email})

def provision(path,email):
    if not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+',email): raise ValueError('Invalid admin email')
    ef=path/'.env'
    fresh=not ef.exists()
    if fresh:
        values={'APP_URL':'https://'+path.name+'.wissen.app.mintapis.com','APP_KEY':'base64:'+base64.b64encode(secrets.token_bytes(32)).decode(),'DB_PASSWORD':secrets.token_hex(32),'DB_ROOT_PASSWORD':secrets.token_hex(32),'BOOKSTACK_ADMIN_EMAIL':email,'BOOKSTACK_ADMIN_PASSWORD':secrets.token_urlsafe(24)}
        ef.write_text(''.join(k+'='+shlex.quote(v)+'\n' for k,v in values.items())); ef.chmod(0o600)
    if not fresh:
        if not (path/'.initialized').exists() or not (path/'docker-compose.yml').exists():
            raise ValueError('Incomplete existing tenant requires operator repair')
        compose(path,'up','-d'); ready_internal(path); public_ready(env_read(ef)['APP_URL'])
        print('RESUMED '+path.name)
        return
    values=env_read(ef); config(path)
    # Bootstrap without public routing so default credentials are never exposed.
    config(path,False) if not (path/'.initialized').exists() else None
    compose(path,'up','-d'); ready_internal(path)
    if not (path/'.initialized').exists():
        php(path,"$v=json_decode(stream_get_contents(STDIN),true); $u=BookStack\\Users\\Models\\User::where('email','admin@admin.com')->first(); if (!$u) {$u=BookStack\\Users\\Models\\User::where('email',$v['email'])->firstOrFail();} $u->email=$v['email']; $u->password=Illuminate\\Support\\Facades\\Hash::make($v['secret']); $u->save();",{'email':values['BOOKSTACK_ADMIN_EMAIL'],'secret':values['BOOKSTACK_ADMIN_PASSWORD']})
        seed_starter_book(path, values['BOOKSTACK_ADMIN_EMAIL'])
        (path/'.initialized').touch()
    config(path); compose(path,'up','-d'); public_ready(values['APP_URL'])
    print('RUNNING '+values['APP_URL'])

def sql(path,query):
    return compose(path,'exec','-T','db','sh','-c','MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb -ubookstack bookstack -N -B',data=query.encode()).decode().strip()

def ensure_key():
    if not KEY.exists():
        try:
            with KEY.open('x') as f: f.write(secrets.token_hex(32)+'\n')
        except FileExistsError: pass
    KEY.chmod(0o600)

def crypt(src, dst, decrypt=False):
    ensure_key()
    if (src.suffix == '.age') if decrypt else bool(shutil.which('age')):
        # age reads passphrases from a controlling terminal, never argv/env.
        args=['age', '-d' if decrypt else '-p', '-o',str(dst),str(src)]
        pid, fd=pty.fork()
        if pid == 0:
            attrs=termios.tcgetattr(0); attrs[3] &= ~termios.ECHO; termios.tcsetattr(0,termios.TCSANOW,attrs)
            os.execvp(args[0],args)
        buf=b''; deadline=time.monotonic()+180
        try:
            while time.monotonic()<deadline:
                if select.select([fd],[],[],1)[0]:
                    try: chunk=os.read(fd,4096)
                    except OSError: break
                    if not chunk: break
                    buf+=chunk
                    if b':' in buf:
                        os.write(fd,KEY.read_bytes().strip()+b'\n'); buf=b''
                done,status=os.waitpid(pid,os.WNOHANG)
                if done:
                    if status: raise RuntimeError('age encryption/decryption failed')
                    return
            done,status=os.waitpid(pid,os.WNOHANG)
            if not done:
                os.kill(pid,signal.SIGKILL); os.waitpid(pid,0)
                raise RuntimeError('age timeout')
            if status: raise RuntimeError('age encryption/decryption failed')
        finally: os.close(fd)
    else:
        run(['openssl','enc','-aes-256-cbc','-pbkdf2','-salt',*(['-d'] if decrypt else []),'-pass','file:'+str(KEY),'-in',str(src),'-out',str(dst)])

def retention(path):
    backups=path/'backups'
    if not backups.exists(): return
    cutoff=time.time()-7*86400
    for old in backups.iterdir():
        try: stamp=datetime.datetime.strptime(old.name[:16],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()
        except ValueError: stamp=old.stat().st_mtime
        if stamp < cutoff or (old.name.startswith('.tmp-') and old.stat().st_mtime < time.time()-86400):
            run(['sudo','-n','rm','-rf','--',str(old)])

def content(path):
    return { 'pages':sql(path,"SELECT COUNT(*) FROM entities WHERE type='page';"),
             'books':sql(path,"SELECT COUNT(*) FROM entities WHERE type='book';"),
             'book_titles':sql(path,"SELECT name FROM entities WHERE type='book' ORDER BY id;"),
             'latest_page':sql(path,"SELECT name FROM entities WHERE type='page' ORDER BY updated_at DESC,id DESC LIMIT 1;") }

def backup(path):
    retention(path)
    if b'bookstack' not in compose(path,'ps','--status','running','--services').splitlines():
        print('BACKUP SKIP suspended '+path.name); return
    ensure_key()
    dest=path/'backups'; dest.mkdir(exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='.tmp-',dir=dest))
    name=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
    encrypted=stage/('snapshot.age' if shutil.which('age') else 'snapshot.enc')
    try:
        compose(path,'stop','bookstack')
        (stage/'database.sql').write_bytes(compose(path,'exec','-T','db','sh','-c','MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb-dump -ubookstack --single-transaction --routines --triggers bookstack'))
        (stage/'content.json').write_text(json.dumps(content(path)))
        run(['sudo','-n','tar','-czf',str(stage/'bookstack.tar.gz'),'-C',str(path),'bookstack'])
        shutil.copy2(path/'.env',stage/'.env'); shutil.copy2(path/'docker-compose.yml',stage/'docker-compose.yml')
        run(['tar','-cf',str(stage/'snapshot.tar'),'-C',str(stage),'database.sql','content.json','bookstack.tar.gz','.env','docker-compose.yml'])
        crypt(stage/'snapshot.tar',encrypted)
        # Authenticate both formats before decryption (CBC itself is not authenticated).
        tag=hmac.new(KEY.read_bytes(),encrypted.read_bytes(),hashlib.sha256).hexdigest()
        final=dest/(name+encrypted.suffix)
        final.with_suffix(final.suffix+'.hmac').write_text(tag)
        encrypted.rename(final)
        print('BACKUP '+str(final))
    finally:
        try: compose(path,'start','bookstack')
        finally: run(['sudo','-n','rm','-rf','--',str(stage)])

def restore(path, src=None):
    choices=[Path(src)] if src is not None else sorted(p for p in (path/'backups').iterdir() if p.suffix in {'.age','.enc'} and p.with_suffix(p.suffix+'.hmac').exists())
    if not choices: raise ValueError('No complete encrypted backup')
    src=choices[-1]
    if not hmac.compare_digest(hmac.new(KEY.read_bytes(),src.read_bytes(),hashlib.sha256).hexdigest(),src.with_suffix(src.suffix+'.hmac').read_text()):
        raise ValueError('Backup authentication failed')
    tmp=ROOT/('restore-'+path.name+'-'+secrets.token_hex(4)); tmp.mkdir()
    try:
        crypt(src,tmp/'snapshot.tar',True)
        run(['tar','-xf',str(tmp/'snapshot.tar'),'-C',str(tmp)])
        # Preserve backed-up images/config; remove all public routing and networks.
        saved=json.loads((tmp/'docker-compose.yml').read_text())
        saved['networks']={'private':{'internal':True}}
        for service in saved['services'].values():
            service['networks']=['private']; service['labels']={'traefik.enable':'false'}
            service.pop('ports',None); service.pop('container_name',None)
        (tmp/'docker-compose.yml').write_text(json.dumps(saved))
        run(['sudo','-n','tar','-xzf',str(tmp/'bookstack.tar.gz'),'-C',str(tmp)])
        compose(tmp,'up','-d','--wait','db'); sql(tmp,(tmp/'database.sql').read_text())
        expected=json.loads((tmp/'content.json').read_text()); actual=content(tmp)
        if actual!=expected: raise RuntimeError('Restored content mismatch')
        compose(tmp,'up','-d'); ready_internal(tmp)
        if content(tmp)!=expected: raise RuntimeError('Restored content changed after startup')
        print('RESTORE OK '+json.dumps(actual,ensure_ascii=False))
    finally:
        try:
            if (tmp/'docker-compose.yml').exists(): compose(tmp,'down','--remove-orphans')
        finally: run(['sudo','-n','rm','-rf','--',str(tmp)])

def purge(path, now=False):
    marker=path/'.destroy_requested_at'
    if not now and (not marker.exists() or time.time()-float(marker.read_text()) < 30*86400):
        print('PURGE deferred '+path.name); return
    compose(path,'down','--remove-orphans')
    run(['sudo','-n','rm','-rf','--',str(path)])
    print('PURGED '+path.name)

def main():
    action=sys.argv[1]; slug=sys.argv[2]
    if not valid_slug(slug) and not (slug=='demo' and (ROOT/slug/'.initialized').exists()): raise ValueError('Invalid or reserved slug')
    ROOT.mkdir(parents=True,exist_ok=True); path=ROOT/slug
    if path.is_symlink(): raise ValueError('Symlink tenant refused')
    if action=='provision': path.mkdir(mode=0o700,exist_ok=True)
    if not path.is_dir(): raise ValueError('Unknown tenant')
    locks=ROOT/'.locks'; locks.mkdir(exist_ok=True)
    with (locks/(slug+'.lock')).open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if action=='provision':
            if (path/'.destroy_requested_at').exists() or (ROOT/'.destroy-requests'/slug).exists(): raise ValueError('Tenant marked for destruction')
            def interrupted(*_): raise RuntimeError('Provisioning interrupted')
            signal.signal(signal.SIGTERM,interrupted)
            try: provision(path,sys.argv[3] if len(sys.argv)>3 else 'admin@'+slug+'.wissen.app.mintapis.com')
            except BaseException:
                signal.signal(signal.SIGTERM,signal.SIG_IGN)
                if (path/'docker-compose.yml').exists(): compose(path,'down','--remove-orphans')
                raise
        elif action=='migrate-network': migrate_network(path)
        elif action=='deprovision': compose(path,'down')
        elif action=='destroy':
            if sys.argv[3:]==['--now','--yes']: purge(path,True)
            elif not sys.argv[3:]:
                marker=path/'.destroy_requested_at'
                if not marker.exists(): marker.write_text(str(time.time()))
                requests=ROOT/'.destroy-requests'; requests.mkdir(exist_ok=True)
                (requests/slug).write_text(marker.read_text())
                compose(path,'down'); print('DESTROY MARKED '+slug)
            else: raise ValueError('Use destroy <slug> or destroy <slug> --now --yes')
        elif action=='purge': purge(path)
        elif action=='retention': retention(path)
        elif action=='backup': backup(path)
        elif action=='restore-test': restore(path)
        else: raise ValueError('Unknown action')
if __name__=='__main__':
    try: main()
    except Exception as exc:
        print('ERROR '+str(exc) if isinstance(exc,(RuntimeError,ValueError)) else 'ERROR operation failed; inspect tenant locally',file=sys.stderr); sys.exit(1)
