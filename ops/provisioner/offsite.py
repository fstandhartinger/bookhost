#!/usr/bin/env python3
"""Encrypted-only off-site replication (R2 or Storage Box). Never emit credentials or diagnostics."""
import base64
import datetime
import fcntl
import hashlib
import hmac
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time

import tenant

WORK = Path('/home/flori/ventures2/bookstack/work')
REMOTE = 'wissen-backups'
ARCHIVE = re.compile(r'^([0-9]{8}T[0-9]{6}Z)\.age$')


def stamp(name):
    match = ARCHIVE.fullmatch(name)
    if not match:
        raise ValueError('Invalid archive name')
    return datetime.datetime.strptime(match[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()


def check_name(name):
    # Only timestamped archives or their sidecars are ever downloaded.
    stamp(name[:-5] if name.endswith('.hmac') else name)


def authenticate(src):
    mac = hmac.new(tenant.KEY.read_bytes(), digestmod=hashlib.sha256)
    with src.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            mac.update(chunk)
    if not hmac.compare_digest(mac.hexdigest(), Path(str(src)+'.hmac').read_text().strip()):
        raise ValueError('Backup authentication failed')


class StorageBox:
    def __init__(self):
        config = WORK/'.storagebox.env'
        if not config.is_file():
            raise ValueError('Storage Box not configured: work/.storagebox.env missing')
        if config.stat().st_mode & 0o077:
            raise ValueError('Storage Box config requires mode 0600')
        env = tenant.env_read(config)
        host, user, key = (env[k] for k in ('STORAGEBOX_HOST','STORAGEBOX_USER','STORAGEBOX_SSHKEY'))
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]+', host) or not re.fullmatch(r'u[0-9]+(?:-sub[0-9]+)?', user):
            raise ValueError('Invalid Storage Box endpoint')
        if not Path(key).is_file() or Path(key).stat().st_mode & 0o077:
            raise ValueError('Storage Box SSH key missing or not private')
        known = WORK/'.storagebox_known_hosts'
        if not known.exists():
            # Independently published Hetzner ED25519 fingerprint, checked 2026-09-08:
            # https://docs.hetzner.com/storage/storage-box/general/#ssh-host-keys
            expected = 'XqONwb1S0zuj5A1CDxpOSuD2hnAArV1A3wKY7Z3sdgM'
            scan = subprocess.run(['ssh-keyscan','-T','20','-p','23','-t','ed25519',host],
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
            verified = []
            for line in scan.stdout.decode().splitlines():
                parts = line.split()
                if len(parts) != 3 or parts[1] != 'ssh-ed25519':
                    continue
                digest = base64.b64encode(hashlib.sha256(base64.b64decode(parts[2])).digest()).decode().rstrip('=')
                if digest != expected:
                    raise ValueError('Storage Box SSH host fingerprint mismatch')
                verified.append(line)
            if not verified:
                raise ValueError('Storage Box SSH host key unavailable')
            with known.open('x') as stream:
                stream.write('\n'.join(verified)+'\n')
        self.target = user+'@'+host
        self.ssh = ['ssh','-p','23','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
                    '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(WORK/'.storagebox_known_hosts'),
                    '-o','ConnectTimeout=20','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3']

    def command(self, args):
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1800)
        if p.returncode:
            raise RuntimeError('Storage Box operation failed (exit '+str(p.returncode)+'); inspect connectivity/configuration')
        return p.stdout.decode()

    def remote(self, *args):
        return self.command([*self.ssh,self.target,shlex.join(args)])

    def names(self, slug=None):
        if slug is None:
            self.remote('mkdir','-p',REMOTE)  # a fresh box has no top-level dir yet
            return self.remote('ls','-1',REMOTE).splitlines()
        return self.remote('ls','-1',REMOTE+'/'+slug).splitlines()

    def upload(self, stage, slug):
        dest = REMOTE+'/'+slug
        self.remote('mkdir','-p',dest)
        # No --delete: remote retention is independent of seven-day local retention.
        self.command(['rsync','-rt','--delay-updates','--timeout=120','-e',shlex.join(self.ssh),
                      str(stage)+'/',self.target+':'+dest+'/'])

    def download(self, slug, name, dest):
        check_name(name)
        self.command(['rsync','-rt','--timeout=120','-e',shlex.join(self.ssh),
                      self.target+':'+REMOTE+'/'+slug+'/'+name,str(dest/name)])

    def delete(self, slug, name):
        self.remote('rm','--',REMOTE+'/'+slug+'/'+name)


class R2Storage:
    def __init__(self, client=None):
        config = WORK/'.r2.env'
        if not config.is_file():
            raise ValueError('R2 not configured: work/.r2.env missing')
        if config.stat().st_mode & 0o077:
            raise ValueError('R2 config requires mode 0600')
        env = tenant.env_read(config)
        if not all(k in env for k in ('R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET','R2_ENDPOINT')):
            raise ValueError('R2 config incomplete')
        if not re.fullmatch(r'https://[0-9a-f]{32}(\.eu)?\.r2\.cloudflarestorage\.com', env['R2_ENDPOINT']):
            raise ValueError('Invalid R2 endpoint')
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,62}', env['R2_BUCKET']):
            raise ValueError('Invalid R2 bucket')
        self.bucket = env['R2_BUCKET']
        self._client = client
        self._params = dict(endpoint_url=env['R2_ENDPOINT'], aws_access_key_id=env['R2_ACCESS_KEY_ID'],
                            aws_secret_access_key=env['R2_SECRET_ACCESS_KEY'], region_name='auto')

    @property
    def client(self):
        if self._client is None:
            import boto3  # lazy: StorageBox-only hosts and tests need no boto3
            self._client = boto3.client('s3', **self._params)
        return self._client

    def _call(self, operation, fn):
        # SDK exception text can contain the access key id; keep it out of errors.
        try:
            return fn()
        except Exception:
            raise RuntimeError('R2 operation failed ('+operation+')') from None

    def names(self, slug=None):
        prefix = REMOTE+'/' if slug is None else REMOTE+'/'+slug+'/'
        def collect():
            found = []
            params = dict(Bucket=self.bucket, Prefix=prefix)
            if slug is None:
                params['Delimiter'] = '/'  # roll up per-tenant prefixes
            for page in self.client.get_paginator('list_objects_v2').paginate(**params):
                if slug is None:
                    found += [p['Prefix'][len(prefix):].strip('/') for p in page.get('CommonPrefixes', [])]
                else:
                    found += [o['Key'].rsplit('/',1)[-1] for o in page.get('Contents', []) if o['Key'] != prefix]
            return found
        return self._call('list_objects_v2', collect)

    def upload(self, stage, slug):
        for src in sorted(stage.iterdir()):
            if src.is_symlink() or not src.is_file():
                continue
            self._call('upload_file', lambda src=src: self.client.upload_file(str(src), self.bucket, REMOTE+'/'+slug+'/'+src.name))

    def download(self, slug, name, dest):
        check_name(name)
        self._call('download_file', lambda: self.client.download_file(self.bucket, REMOTE+'/'+slug+'/'+name, str(dest/name)))

    def delete(self, slug, name):
        self._call('delete_object', lambda: self.client.delete_object(Bucket=self.bucket, Key=REMOTE+'/'+slug+'/'+name))


def storage():
    return R2Storage() if (WORK/'.r2.env').exists() else StorageBox()


def valid_slug(slug):
    return slug == 'demo' or tenant.valid_slug(slug)


def prune(storage, slug, now):
    # Only timestamped encrypted archives/sidecars in this service's namespace.
    for name in sorted(storage.names(slug)):
        base = name[:-5] if name.endswith('.hmac') else name
        if ARCHIVE.fullmatch(base) and stamp(base) < now-30*86400:
            storage.delete(slug, name)


def sync(storage):
    now = time.time()
    locks = tenant.ROOT/'.locks'
    locks.mkdir(exist_ok=True)
    count = 0
    for path in sorted(tenant.ROOT.iterdir()):
        if path.is_symlink() or not path.is_dir() or not valid_slug(path.name):
            continue
        with (locks/(path.name+'.lock')).open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            # Hardlinks keep snapshots stable if local retention runs after unlocking.
            with tempfile.TemporaryDirectory(prefix='.offsite-',dir=tenant.ROOT) as tmp:
                stage = Path(tmp)
                for src in sorted((path/'backups').glob('*.age')):
                    if src.is_symlink() or not ARCHIVE.fullmatch(src.name) or stamp(src.name) < now-30*86400:
                        continue
                    sidecar = Path(str(src)+'.hmac')
                    if not sidecar.is_file() or sidecar.is_symlink():
                        continue
                    authenticate(src)
                    os.link(src,stage/src.name)
                    os.link(sidecar,stage/sidecar.name)
                    count += 1
                if any(stage.iterdir()):
                    storage.upload(stage,path.name)
    # Also expire snapshots for tenants already purged locally.
    for slug in storage.names():
        if valid_slug(slug):
            prune(storage,slug,now)
    print('OFFSITE SYNC OK archives='+str(count))


def download_newest(storage, slug, dest):
    # Newest complete remote pair, downloaded into dest and authenticated there.
    names = set(storage.names(slug))
    choices = sorted(n for n in names if ARCHIVE.fullmatch(n) and n+'.hmac' in names)
    if not choices:
        raise ValueError('No complete remote age backup')
    name = choices[-1]
    storage.download(slug,name,dest)
    storage.download(slug,name+'.hmac',dest)
    authenticate(dest/name)
    return dest/name


def restore(storage, slug):
    if not valid_slug(slug):
        raise ValueError('Invalid tenant slug')
    with tempfile.TemporaryDirectory(prefix='.offsite-restore-',dir=tenant.ROOT) as tmp:
        tenant.restore(tenant.ROOT/slug, src=download_newest(storage,slug,Path(tmp)))


def verify(storage, slug):
    if not valid_slug(slug):
        raise ValueError('Invalid tenant slug')
    with tempfile.TemporaryDirectory(prefix='.offsite-verify-',dir=tenant.ROOT) as tmp:
        src = download_newest(storage,slug,Path(tmp))
        size = src.stat().st_size
        print('OFFSITE VERIFY OK slug='+slug+' archive='+src.name+' bytes='+str(size))


def main():
    tenant.ROOT.mkdir(parents=True,exist_ok=True)
    with (tenant.ROOT/'.offsite.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        backend = storage()
        if sys.argv[1:] == ['sync']:
            sync(backend)
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(backend,sys.argv[2])
        elif len(sys.argv) == 3 and sys.argv[1] == 'verify':
            verify(backend,sys.argv[2])
        else:
            raise ValueError('Usage: offsite.py sync | restore <slug> | verify <slug>')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('OFFSITE ERROR '+(str(exc) if isinstance(exc,(ValueError,RuntimeError)) else 'operation failed; inspect configuration locally'),file=sys.stderr)
        sys.exit(1)
