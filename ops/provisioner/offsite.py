#!/usr/bin/env python3
"""Encrypted-only Storage Box replication. Never emit credentials or SSH diagnostics."""
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


def authenticate(src):
    mac = hmac.new(tenant.KEY.read_bytes(), digestmod=hashlib.sha256)
    with src.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            mac.update(chunk)
    if not hmac.compare_digest(mac.hexdigest(), Path(str(src)+'.hmac').read_text().strip()):
        raise ValueError('Backup authentication failed')


class Storage:
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

    def names(self, path):
        return self.remote('ls','-1',path).splitlines()

    def upload(self, stage, slug):
        dest = REMOTE+'/'+slug
        self.remote('mkdir','-p',dest)
        # No --delete: remote retention is independent of seven-day local retention.
        self.command(['rsync','-rt','--delay-updates','--timeout=120','-e',shlex.join(self.ssh),
                      str(stage)+'/',self.target+':'+dest+'/'])

    def download(self, slug, name, dest):
        stamp(name)
        self.command(['rsync','-rt','--timeout=120','-e',shlex.join(self.ssh),
                      self.target+':'+REMOTE+'/'+slug+'/'+name,str(dest/name)])


def valid_slug(slug):
    return slug == 'demo' or tenant.valid_slug(slug)


def prune(storage, slug, now):
    names = set(storage.names(REMOTE+'/'+slug))
    # Only timestamped encrypted archives/sidecars in this service's namespace.
    for name in sorted(names):
        base = name[:-5] if name.endswith('.hmac') else name
        if ARCHIVE.fullmatch(base) and stamp(base) < now-30*86400:
            storage.remote('rm','--',REMOTE+'/'+slug+'/'+name)


def sync(storage):
    now = time.time()
    storage.remote('mkdir','-p',REMOTE)
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
    for slug in storage.names(REMOTE):
        if valid_slug(slug):
            prune(storage,slug,now)
    print('OFFSITE SYNC OK archives='+str(count))


def restore(storage, slug):
    if not valid_slug(slug):
        raise ValueError('Invalid tenant slug')
    names = set(storage.names(REMOTE+'/'+slug))
    choices = sorted(n for n in names if ARCHIVE.fullmatch(n) and n+'.hmac' in names)
    if not choices:
        raise ValueError('No complete remote age backup')
    with tempfile.TemporaryDirectory(prefix='.offsite-restore-',dir=tenant.ROOT) as tmp:
        dest = Path(tmp)
        name = choices[-1]
        storage.download(slug,name,dest)
        # Sidecar download uses the same fixed filename, with no shell input from listing.
        storage.command(['rsync','-rt','--timeout=120','-e',shlex.join(storage.ssh),
                         storage.target+':'+REMOTE+'/'+slug+'/'+name+'.hmac',str(dest/(name+'.hmac'))])
        authenticate(dest/name)
        tenant.restore(tenant.ROOT/slug, src=dest/name)


def main():
    tenant.ROOT.mkdir(parents=True,exist_ok=True)
    with (tenant.ROOT/'.offsite.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        storage = Storage()
        if sys.argv[1:] == ['sync']:
            sync(storage)
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(storage,sys.argv[2])
        else:
            raise ValueError('Usage: offsite.py sync | restore <slug>')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('OFFSITE ERROR '+(str(exc) if isinstance(exc,(ValueError,RuntimeError)) else 'operation failed; inspect configuration locally'),file=sys.stderr)
        sys.exit(1)
