#!/usr/bin/env python3
"""Import a customer's SQL + local uploads into a starter-only BookHost tenant."""
import argparse
import contextlib
import fcntl
import gzip
import json
from pathlib import Path, PurePosixPath
import shutil
import signal
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit

import tenant
from tenant import backup
from bookstack_api_token import ensure_token, kms_key


def open_dump(path):
    with Path(path).open('rb') as source:
        compressed = source.read(2) == b'\x1f\x8b'
    return gzip.open(path, 'rb') if compressed else Path(path).open('rb')


def archive_members(path):
    result = []
    seen = set()
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or '\\' in member.name:
                raise ValueError('Unsafe file archive path')
            parts = list(name.parts)
            if parts and parts[0] == 'bookstack': parts.pop(0)
            if parts and parts[0] == 'www': parts.pop(0)
            if member.isdir(): continue
            if not member.isfile() or not parts or parts[0] not in ('uploads', 'files') or len(parts)<2:
                raise ValueError('Archive must contain only regular uploads/ or files/ files')
            target = ('www/' if parts[0]=='uploads' else '') + '/'.join(parts)
            if target in seen: raise ValueError('Duplicate file archive path')
            seen.add(target)
            result.append((member.name, target))
            # Read fully now: corrupt gzip/tar must fail before any tenant mutation.
            with archive.extractfile(member) as stream:
                while stream.read(1024*1024): pass
    return result


def counts(path):
    result = {}
    for kind in ('book','page','chapter'):
        result[kind+'s'] = int(tenant.sql(path, "SELECT COUNT(*) FROM entities WHERE type='"+kind+"';"))
    for table in ('attachments','images','users'):
        result[table] = int(tenant.sql(path, 'SELECT COUNT(*) FROM '+table+';'))
    return result


def check_starter(path):
    # Compare content with the actual provisioner's seed, not names/counts alone.
    seed = tenant.seed_starter_book.__code__.co_consts
    script = next(s for s in seed if isinstance(s,str) and 'publishDraft' in s)
    import re
    html = re.search("'html'=>'([^']*)'", script).group(1)
    result = tenant.php(path, r'''
$v=json_decode(stream_get_contents(STDIN),true);
$entities=Illuminate\Support\Facades\DB::table('entities')->get();
foreach($entities as $e) {
 if ($e->deleted_at) {echo 'nonempty'; exit;}
 if ($e->type==='book' && $e->name==='Team handbook' && BookStack\Entities\Models\Book::findOrFail($e->id)->description_html==='<p>A home for your team knowledge.</p>') continue;
 if ($e->type==='page' && $e->name==='How to use this wiki') {
  $p=BookStack\Entities\Models\Page::findOrFail($e->id);
  if (preg_replace('/ id="bkmrk-[^"]*"/', '', $p->html)===$v['html'] && !$p->draft) continue;
 }
 echo 'nonempty'; exit;
}
if ($entities->where('type','book')->count()>1 || $entities->where('type','page')->count()>1 ||
 Illuminate\Support\Facades\DB::table('attachments')->count() || Illuminate\Support\Facades\DB::table('images')->count()) {echo 'nonempty';} else {echo 'empty';}
''', {'html':html})
    if result.strip()!=b'empty': raise ValueError('Target is not empty: only unchanged initial starter content may be replaced')


def artisan(path, command):
    return tenant.compose(path,'exec','-T','-u','1000:1000','-w','/app/www','bookstack','php','artisan',*command)


def import_dump(path, dump):
    # Application DB user cannot access other tenants or server-wide administration.
    tables = tenant.sql(path,'SHOW FULL TABLES WHERE Table_type = "BASE TABLE";')
    names = [line.split('\t')[0] for line in tables.splitlines()]
    if names:
        tenant.sql(path,'SET FOREIGN_KEY_CHECKS=0; DROP TABLE '+','.join('`'+n.replace('`','``')+'`' for n in names)+'; SET FOREIGN_KEY_CHECKS=1;')
    with open_dump(dump) as stream:
        tenant.compose(path,'exec','-T','db','sh','-c',
            'MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb --binary-mode=1 -ubookstack bookstack',data=stream.read())


def install_files(path, source):
    with tempfile.TemporaryDirectory(prefix='bookhost-import-') as folder:
        stage=Path(folder)
        with tarfile.open(source,'r:gz') as archive:
            for original, relative in archive_members(source):
                target=stage/relative
                target.parent.mkdir(parents=True,exist_ok=True)
                with archive.extractfile(original) as src, target.open('wb') as dest:
                    shutil.copyfileobj(src,dest)
        for relative in ('www/uploads','files'):
            target=path/'bookstack'/relative
            tenant.run(['sudo','-n','rm','-rf','--',str(target)])
            tenant.run(['sudo','-n','mkdir','-p',str(target)])
            if (stage/relative).exists():
                tenant.run(['sudo','-n','cp','-a',str(stage/relative)+'/.',str(target)])
            tenant.run(['sudo','-n','chown','-R','1000:1000',str(target)])

    # LinuxServer v26 mounts storage/uploads/files at /config/www/files. Keep the
    # canonical backup-aware files root and point the runtime path to it.
    runtime=path/'bookstack/www/files'
    tenant.run(['sudo','-n','rm','-rf','--',str(runtime)])
    tenant.run(['sudo','-n','ln','-s','../files',str(runtime)])


def verify_local_files(path, allow_missing_files=False):
    # Execute in the container as the application UID: host root permissions and
    # symlink layout must not hide files unreadable by the actual application.
    raw = tenant.php(path, r'''
$count=0; $examples=[];
$missing=function($path) use (&$count,&$examples) {
 $count++; if(count($examples)<10) $examples[]=preg_replace('/[\x00-\x1f\x7f]/','?',substr($path,0,250));
};
$files=app(BookStack\Uploads\FileStorage::class);
$images=app(BookStack\Uploads\ImageStorage::class);
if (!in_array(config('filesystems.attachments'),['local','local_secure','local_secure_restricted']) ||
 !in_array(config('filesystems.images'),['local','local_secure','local_secure_restricted'])) {
 throw new RuntimeException('Local import validation requires local file storage');
}
Illuminate\Support\Facades\DB::table('attachments')->orderBy('id')->chunk(200,function($rows) use($files,$missing) {
 foreach($rows as $row) {
  if($row->external) continue; // Explicit link attachments are not local files.
  $path=$files->getSystemPath($row->path);
  if(!$path || !is_file($path) || !is_readable($path)) $missing($row->path);
 }
});
Illuminate\Support\Facades\DB::table('images')->orderBy('id')->chunk(200,function($rows) use($images,$missing) {
 foreach($rows as $row) {
  $disk=$images->getDisk($row->type);
  $relative=ltrim(BookStack\Util\FilePathNormalizer::normalize(str_replace('uploads/images/','',$row->path)),'/');
  $path=$disk->usingSecureImages() ? storage_path('uploads/images/'.$relative) : public_path('uploads/images/'.$relative);
  if(!$row->path || !is_file($path) || !is_readable($path)) $missing($row->path);
 }
});
echo json_encode(['missing_count'=>$count,'examples'=>$examples]);
''')
    result=json.loads(raw)
    count=result['missing_count']
    if not isinstance(count,int) or count<0 or not isinstance(result['examples'],list):
        raise ValueError('Invalid file verification result')
    if count:
        message='Missing local files: '+str(count)+'; examples: '+json.dumps(result['examples'])
        if not allow_missing_files: raise ValueError(message)
        print('WARNING --allow-missing-files: '+message+'; incomplete import explicitly accepted.',flush=True)
    elif allow_missing_files:
        print('WARNING --allow-missing-files enabled; no missing local files found.',flush=True)
    return result


def rewrite_links(path, old_url, new_url):
    return int(tenant.php(path, r'''
$v=json_decode(stream_get_contents(STDIN),true); $count=0;
$db=Illuminate\Support\Facades\DB::class; $schema=Illuminate\Support\Facades\Schema::class;
// Older releases use separate tables; current releases keep shared fields in entities.
$fields=['pages'=>['html','markdown'],'chapters'=>['description_html'],'books'=>['description_html'],
 'entity_page_data'=>['html','markdown'],'entity_container_data'=>['description_html'],'images'=>['url']];
foreach($fields as $table=>$columns) {
 if (!$schema::hasTable($table)) continue;
 foreach($columns as $column) {
  if (!$schema::hasColumn($table,$column)) continue;
  $key=$table==='entity_page_data' ? 'page_id' : ($table==='entity_container_data' ? 'entity_id' : 'id');
  $db::table($table)->orderBy($key)->chunk(200,function($rows) use($db,$table,$column,$key,$v,&$count) {
   foreach($rows as $row) {
    $text=$row->$column ?? ''; $n=0;
    $text=preg_replace_callback('~'.preg_quote($v['old'],'~').'(?=[/\\?#\s"\'<>)]|$)~u',function() use($v) {return $v['new'];},$text,-1,$n);
    if($n) {$query=$db::table($table)->where($key,$row->$key); if($table==='entity_container_data') $query->where('entity_type',$row->entity_type); $query->update([$column=>$text]); $count+=$n;}
   }
  });
 }
}
echo $count;
''', {'old':old_url.rstrip('/'),'new':new_url.rstrip('/')}))


def rollback(path, archive):
    """Restore the target in place; tenant.restore is a disposable verification only."""
    import hashlib, hmac
    if not hmac.compare_digest(hmac.new(tenant.KEY.read_bytes(),archive.read_bytes(),hashlib.sha256).hexdigest(),
                               archive.with_suffix(archive.suffix+'.hmac').read_text()):
        raise ValueError('Recovery archive authentication failed')
    with tempfile.TemporaryDirectory(prefix='bookhost-rollback-') as folder:
        stage=Path(folder)
        tenant.crypt(archive,stage/'snapshot.tar',True)
        tenant.run(['tar','-xf',str(stage/'snapshot.tar'),'-C',str(stage)])
        import_dump(path,stage/'database.sql')
        for child in (path/'bookstack').iterdir():
            tenant.run(['sudo','-n','rm','-rf','--',str(child)])
        tenant.run(['sudo','-n','tar','-xzf',str(stage/'bookstack.tar.gz'),'-C',str(path)])
        shutil.copy2(stage/'.env',path/'.env')
        artisan(path,['up'])
        tenant.service_recovered(path)


def import_bookstack(slug, dump, files, old_url=None, dry_run=False, allow_missing_files=False):
    if not tenant.valid_slug(slug): raise ValueError('Invalid or reserved tenant slug')
    if slug in ('demo','qa-bookhost-0909'): raise ValueError('Protected tenant')
    path=tenant.ROOT/slug
    if path.is_symlink() or not path.is_dir(): raise ValueError('Tenant does not exist')
    if not all((path/name).is_file() for name in ('.initialized','.env','docker-compose.yml')):
        raise ValueError('Tenant is not initialized')
    # Existing lifecycle lock is used without creating/truncating anything on dry-run.
    lockpath=tenant.ROOT/'.locks'/(slug+'.lock')
    with (lockpath.open('r') if lockpath.exists() else contextlib.nullcontext()) as lock:
        if lock is not None: fcntl.flock(lock,fcntl.LOCK_EX)
        running=tenant.compose(path,'ps','--status','running','--services').splitlines()
        if not {b'bookstack',b'db'}.issubset(set(running)): raise ValueError('Tenant is not running (BookStack and DB required)')
        before=counts(path); check_starter(path)
        for source in (dump,files):
            try:
                with Path(source).open('rb') as stream:
                    if not stream.read(1): raise ValueError('Input file is empty')
            except OSError: raise ValueError('Input file missing or unreadable: '+str(source)) from None
        with open_dump(dump) as stream:
            while stream.read(1024*1024): pass
        members=archive_members(files)
        values=tenant.env_read(path/'.env'); new_url=values['APP_URL']
        if old_url:
            u=urlsplit(old_url)
            if u.scheme not in ('http','https') or not u.hostname or u.username or u.query or u.fragment:
                raise ValueError('old-url must be an HTTP(S) base URL without credentials/query/fragment')
        kms_key()  # Fail before backup/mutation if intake encryption is unavailable.
        print('BEFORE '+json.dumps(before),flush=True)
        print('PLAN hot backup; maintenance; SQL import; migrate; '+str(len(members))+
              ' files; '+('rewrite links; ' if old_url else '')+'intake token reinstall; search; permissions; cache; resume',flush=True)
        if dry_run: return {'before':before,'dry_run':True}
        if lock is None: raise ValueError('Lifecycle lock missing; provision tenant via tenant.py first')
        archive=backup(path,hot=True)
        if not archive: raise RuntimeError('No backup archive created; import aborted')
        print('RECOVERY ARCHIVE '+str(archive),flush=True)
        phase='maintenance'
        changed=False
        try:
            tenant.compose(path,'exec','-T','bookstack','chown','1000:1000','/app/www/storage/framework')
            artisan(path,['down'])
            # Recheck under maintenance: a user may have written since preflight.
            check_starter(path)
            phase='SQL import'
            changed=True
            import_dump(path,dump)
            phase='schema migration'
            artisan(path,['migrate','--force'])
            phase='file import'
            install_files(path,files)
            phase='link rewriting'
            links=rewrite_links(path,old_url,new_url) if old_url else 0
            phase='intake token reinstall'
            ensure_token(slug,reinstall=True,locked=True)
            phase='search, permissions and cache'
            artisan(path,['bookstack:regenerate-search'])
            artisan(path,['bookstack:regenerate-permissions'])
            artisan(path,['cache:clear'])
            artisan(path,['view:clear'])
            after=counts(path)
            phase='local file verification'
            file_check=verify_local_files(path,allow_missing_files)
            artisan(path,['up'])
            tenant.service_recovered(path)
        except BaseException as error:
            detail = str(error) if phase=='local file verification' and isinstance(error,ValueError) else ''
            try:
                if changed:
                    rollback(path,archive)
                    state='Target restored to pre-import backup.'
                else:
                    artisan(path,['up'])
                    tenant.service_recovered(path)
                    state='Import had not started; original target retained.'
            except BaseException:
                # Fail closed: never serve a partial import if recovery also fails.
                try: tenant.compose(path,'stop','bookstack')
                except Exception: pass
                state='Recovery failed; BookStack stopped. Operator restore required.'
            raise RuntimeError('Import failed during '+phase+'. '+detail+' '+state+' Recovery archive: '+str(archive)) from None
        result={'before':before,'after':after,'rewritten_links':links,'backup':str(archive),'file_check':file_check,'allow_missing_files':allow_missing_files}
        print('IMPORTED '+json.dumps(result),flush=True)
        print('ADMIN LOGIN: use the CUSTOMER credentials from the imported instance; the initial BookHost password no longer applies. MFA/encrypted settings may require customer recovery. Intake token reinstalled; existing credentials retained when present, encrypted values stored in tenant .env.',flush=True)
        return result


class ImportParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(1, 'ERROR '+message+'\n')


def main():
    parser=ImportParser(description=__doc__)
    parser.add_argument('slug'); parser.add_argument('--sql',required=True,type=Path)
    parser.add_argument('--files',required=True,type=Path)
    parser.add_argument('--old-url'); parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--allow-missing-files',action='store_true',help='Explicitly accept missing local attachments/images; logged in result')
    args=parser.parse_args()
    def interrupted(*_): raise RuntimeError('Import interrupted')
    signal.signal(signal.SIGTERM,interrupted)
    try: import_bookstack(args.slug,args.sql,args.files,args.old_url,args.dry_run,args.allow_missing_files)
    except BaseException as exc:
        print('ERROR '+(str(exc) if isinstance(exc,(RuntimeError,ValueError)) else 'Import failed; inspect inputs and tenant locally. Credentials withheld.'),file=sys.stderr)
        return 1
    return 0

if __name__=='__main__': sys.exit(main())
