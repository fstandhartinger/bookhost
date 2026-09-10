#!/usr/bin/env python3
"""Export a customer's complete BookHost workspace: SQL dump, storage, manifest."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile

import tenant

RESTORE_GUIDE = (
    'This archive contains a complete BookStack workspace: bookstack.sql (database dump) '
    'and storage.tar.gz (uploaded files and images). To restore into any BookStack instance: '
    '1) Create an empty database (e.g. "bookstack") and import the dump: '
    'mariadb -u <user> -p bookstack < bookstack.sql. '
    '2) Extract storage.tar.gz and copy bookstack/files/ into storage/uploads/files/ and '
    'bookstack/www/uploads/ into storage/uploads/ of your BookStack installation '
    '(LinuxServer.io image: /config/www/files and /config/www/uploads). '
    '3) Point the instance at the imported database, then run: php artisan migrate --force; '
    'php artisan cache:clear; php artisan bookstack:regenerate-search; '
    'php artisan bookstack:regenerate-permissions. '
    'On BookHost, restore with: import-bookstack.py <slug> --sql bookstack.sql --files storage.tar.gz.'
)


def require_tenant(slug):
    if not tenant.valid_slug(slug): raise ValueError('Invalid or reserved tenant slug')
    path = tenant.ROOT/slug
    if path.is_symlink() or not path.is_dir(): raise ValueError('Tenant does not exist')
    if not all((path/name).is_file() for name in ('.initialized', '.env', 'docker-compose.yml')):
        raise ValueError('Tenant is not initialized')
    return path


def counts(path):
    result = {}
    for kind in ('book', 'chapter', 'page'):
        result[kind+'s'] = int(tenant.sql(path, "SELECT COUNT(*) FROM entities WHERE type='"+kind+"';"))
    for table in ('attachments', 'images', 'users'):
        result[table] = int(tenant.sql(path, 'SELECT COUNT(*) FROM '+table+';'))
    return result


def bookstack_image(path):
    try:
        image = json.loads((path/'docker-compose.yml').read_text())['services']['bookstack']['image']
    except Exception:
        return None, None
    tail = image.rsplit('/', 1)[-1]
    return image, (tail.rsplit(':', 1)[1] if ':' in tail else None)


def digest(file):
    hashed = hashlib.sha256(); size = 0
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            hashed.update(chunk); size += len(chunk)
    return {'bytes': size, 'sha256': hashed.hexdigest()}


def dump_database(path, target):
    # Hot dump like backup(): --single-transaction, the service keeps running.
    data = tenant.compose(path, 'exec', '-T', 'db', 'sh', '-c',
        'MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb-dump -ubookstack --single-transaction --routines --triggers bookstack')
    if not data.strip(): raise RuntimeError('Database dump is empty')
    target.write_bytes(data)


def pack_storage(path, target):
    # Canonical prefixes match import-bookstack.py and tenant.archive_upload_hashes.
    www = path/'bookstack'/'www'
    members = []
    if (www/'uploads').is_dir() and not (www/'uploads').is_symlink():
        members.append('bookstack/www/uploads')
    canonical = path/'bookstack'/'files'; legacy = www/'files'
    if canonical.is_dir() and not canonical.is_symlink():
        members.append('bookstack/files')
    elif legacy.is_dir() and not legacy.is_symlink():
        members.append('bookstack/www/files')
    if not members: raise RuntimeError('No BookStack storage directories found')
    command = ['sudo', '-n', 'tar', '-czf', str(target), '-C', str(path)]
    if 'bookstack/www/files' in members:
        command += ['--transform', 's,^bookstack/www/files,bookstack/files,']
    tenant.run(command + members)


def copy_backups(path, staging):
    # Archives plus their authentication tags; the key never leaves the host.
    source = path/'backups'
    archives = sorted(p for p in source.iterdir()
                      if p.suffix in ('.age', '.enc') and p.with_suffix(p.suffix+'.hmac').is_file()) if source.is_dir() else []
    if not archives: return []
    dest = staging/'backups'; dest.mkdir()
    for archive in archives:
        shutil.copy2(archive, dest/archive.name)
        shutil.copy2(archive.with_suffix(archive.suffix+'.hmac'), dest/(archive.name+'.hmac'))
    return [archive.name for archive in archives]


def export_tenant(slug, out, include_backups=False):
    path = require_tenant(slug)
    out = Path(out)
    if out.exists() and not out.is_dir():
        raise ValueError('Output path is not a directory: '+str(out))
    tenant_root = path.resolve(); resolved = out.resolve()
    if resolved == tenant_root or tenant_root in resolved.parents:
        raise ValueError('Output directory must not be inside the tenant')
    try:
        out.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='.export-', dir=out))
    except OSError:
        raise ValueError('Output directory is not writable: '+str(out)) from None
    created = []
    try:
        dump = staging/'bookstack.sql'; dump_database(path, dump)
        archive = staging/'storage.tar.gz'; pack_storage(path, archive)
        archives = copy_backups(path, staging) if include_backups else []
        image, version = bookstack_image(path)
        stats = counts(path)
        manifest = {'tool': 'bookhost-export-tenant', 'format': 1, 'slug': slug,
                    'exported_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                    'bookstack_image': image, 'bookstack_version': version,
                    'counts': stats,
                    'bookstack.sql': digest(dump), 'storage.tar.gz': digest(archive),
                    'restore': RESTORE_GUIDE}
        if include_backups: manifest['backups'] = archives
        (staging/'MANIFEST.json').write_text(json.dumps(manifest, indent=2)+'\n')
        names = ['bookstack.sql', 'storage.tar.gz'] + (['backups'] if archives else []) + ['MANIFEST.json']
        for name in names:
            os.replace(staging/name, out/name); created.append(out/name)
        result = {'slug': slug, 'out': str(out), 'counts': stats}
        if include_backups: result['backups'] = len(archives)
        return result
    except BaseException:
        for artifact in created:
            if artifact.is_dir(): shutil.rmtree(artifact, ignore_errors=True)
            else: artifact.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)


class ExportParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(1, 'ERROR '+message+'\n')


def main(argv=None):
    parser = ExportParser(description=__doc__)
    parser.add_argument('slug'); parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--include-backups', action='store_true',
                        help='Also copy encrypted backup archives (keys are never exported)')
    args = parser.parse_args(argv)
    def interrupted(*_): raise RuntimeError('Export interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        result = export_tenant(args.slug, args.out, args.include_backups)
    except BaseException as exc:
        print('ERROR '+(str(exc) if isinstance(exc, (RuntimeError, ValueError))
                        else 'Export failed; inspect tenant and output locally.'), file=sys.stderr)
        return 1
    print('EXPORTED '+json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__': sys.exit(main())
