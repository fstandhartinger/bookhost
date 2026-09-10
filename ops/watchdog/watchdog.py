#!/usr/bin/env python3
"""Read-only service checks; Python standard library plus the host psql client."""
import argparse
import base64
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sys
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from urllib.parse import urlsplit

sys.path.append(str(Path(__file__).resolve().parents[1] / 'provisioner'))
from capacity import capacity_limits, thresholds, running_tenants, disk_state

ROOT = Path('/home/flori/ventures2/bookstack/tenants')
LOG = ROOT / 'watchdog.log'
LABELS = ['Control-Plane', 'Demo', 'Tenant-Logins', 'Bereitstellung', 'Backups', 'Host und Worker', 'Dokument-Eingang']


def provisioning_state(db):
    """Overdue work plus tenants whose actual state contradicts what was ordered.

    A failed provisioning is terminal: the worker skips such rows, and every
    other watchdog query looks at running tenants only. Without this the tenant
    of a paying customer could vanish from all lists, and an earlier alert would
    even be followed by "recovered" although nothing had recovered.
    """
    stranded = db.get('stranded') or []
    unsuspended = db.get('unsuspended') or []
    detail = f"überfällig: provisioning={db['provisioning']}, pending={db['pending']}"
    if stranded:
        detail += '; GESTRANDET (soll laufen, tut es nicht): ' + ', '.join(stranded)
    if unsuspended:
        detail += '; nicht ausgesetzt (soll ausgesetzt sein, laeuft weiter): ' + ', '.join(unsuspended)
    ok = db['provisioning'] == 0 and db['pending'] == 0 and not stranded and not unsuspended
    return ok, detail


def stamp(now):
    return dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(timespec='seconds')


def transition(previous, ok, now):
    """Return candidate state and optional notification. Commit only after delivery."""
    old = previous or {'status': 'ok', 'since': stamp(now), 'failures': 0, 'alerted': False}
    status = 'ok' if ok else 'fail'
    state = {'status': status, 'since': old['since'] if old['status'] == status else stamp(now),
             'failures': 0 if ok else old.get('failures', 0) + 1,
             'alerted': old.get('alerted', False)}
    event = None
    if ok:
        if state['alerted']:
            event = 'recovery'
        state['alerted'] = False
    elif state['failures'] >= 2 and not state['alerted']:
        event = 'failure'
        state['alerted'] = True
    return state, event


def message(label, state, event):
    first = (f'BookHost: {label} ausgefallen seit {state["since"]}' if event == 'failure'
             else f'BookHost: {label} wieder ok seit {state["since"]}')
    return first + '\n' + ('Bitte Ursache prüfen.' if event == 'failure' else 'Störung beendet.') + f'\nLog: {LOG}'


def send(text):
    # Never include API URL, response body, credentials or exception text in logs.
    token, chat = os.environ['TG_BOT_TOKEN'], os.environ['TG_CHAT_ID']
    data = urllib.parse.urlencode({'chat_id': chat, 'text': text}).encode()
    request = urllib.request.Request(f'https://api.telegram.org/bot{token}/sendMessage', data=data)
    with urllib.request.urlopen(request, timeout=15) as response:
        if not json.load(response).get('ok'):
            raise RuntimeError('Delivery rejected')


def database():
    url = urllib.parse.urlsplit(os.environ['DATABASE_URL_LOCAL'])
    env = os.environ.copy()
    # Force verified TLS, irrespective of URL query defaults. No DSN in argv.
    env.update(PGHOST=os.environ['DATABASE_SSL_SERVERNAME'], PGHOSTADDR=url.hostname,
               PGPORT=str(url.port or 5432), PGUSER=urllib.parse.unquote(url.username or ''),
               PGPASSWORD=urllib.parse.unquote(url.password or ''),
               PGDATABASE=urllib.parse.unquote(url.path.lstrip('/')), PGSSLMODE='verify-full',
               PGCONNECT_TIMEOUT='8')
    env.pop('PGOPTIONS', None)
    query = """BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
 'running', COALESCE((SELECT json_agg(json_build_object('slug',slug,'host',COALESCE(to_jsonb(tenants)->>'host',slug||'.wissen.app.mintapis.com'),'created',extract(epoch from created_at)) ORDER BY slug) FROM tenants WHERE status='running'), '[]'::json),
 'provisioning', (SELECT count(*) FROM tenants WHERE status='provisioning' AND updated_at < now()-interval '20 minutes'),
 'pending', (SELECT count(*) FROM tenants WHERE status='pending' AND created_at < now()-interval '15 minutes'),
 'drafting', (SELECT count(*) FROM intake_items WHERE status='drafting' AND updated_at < now()-interval '30 minutes'),
 'stranded', COALESCE((SELECT json_agg(slug ORDER BY slug) FROM tenants
   WHERE desired_state='running' AND status NOT IN ('running','pending','provisioning')), '[]'::json),
 'unsuspended', COALESCE((SELECT json_agg(slug ORDER BY slug) FROM tenants
   WHERE desired_state='suspended' AND status='running'
     AND updated_at < now()-interval '30 minutes'), '[]'::json));
ROLLBACK;
"""
    with tempfile.TemporaryDirectory(prefix='wissen-watchdog-tls-') as tmp:
        ca = Path(tmp) / 'ca.pem'
        ca.write_bytes(base64.b64decode(os.environ['DATABASE_SSL_CA_BASE64'], validate=True))
        ca.chmod(0o600)
        env['PGSSLROOTCERT'] = str(ca)
        result = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
                                input=query, text=True, capture_output=True, env=env, timeout=30)
        if result.returncode:
            raise RuntimeError('Database check unavailable')
        return json.loads(result.stdout)


def http(url, health=False, contains=None):
    """A page counts as healthy only if it is still ours and shows its content.

    Status 200 alone proved too little: urlopen follows redirects, so a proxy
    could answer with a maintenance page, a different workspace or another site
    entirely and the check stayed green. The final host must therefore match the
    one we asked for, and the body must carry a marker only the real page has.
    """
    start = time.monotonic()
    request = urllib.request.Request(url, headers={'User-Agent': 'BookHost-Operator-Watchdog/1.0'})
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 200:
            return False
        if urlsplit(response.geturl()).hostname != urlsplit(url).hostname:
            return False
        if health:
            body = json.loads(response.read(65536))
            return body.get('db') is True and time.monotonic() - start < 5
        if contains is not None:
            body = response.read(262144).decode('utf-8', 'replace')
            return contains in body
        return True


# A backup that the watchdog counts must look like a backup, not merely carry
# the name of one. Before this check an empty file, a truncated archive, a
# directory called something.age or an archive whose signature had gone missing
# all reported "Backups: ok". The age comes from the timestamp in the file name,
# because a copy or a touch gives an old archive a fresh mtime.
MIN_BACKUP_BYTES = 4096
BACKUP_NAME = re.compile(r'^(\d{8}T\d{6}Z)\.age$')


def backup_time(path, now):
    """Seconds since this archive was taken, or None if it cannot be trusted."""
    match = BACKUP_NAME.match(path.name)
    if match:
        try:
            taken = dt.datetime.strptime(match.group(1), '%Y%m%dT%H%M%SZ').replace(
                tzinfo=dt.timezone.utc).timestamp()
        except ValueError:
            taken = None
        if taken is not None:
            # A timestamp in the future is not evidence of a fresh backup.
            return None if taken > now + 300 else now - taken
    # No usable timestamp in the name. The mtime is not a substitute: copying or
    # touching an archive would make it look like it was taken seconds ago.
    return None


def usable_backups(directory, now):
    """Archives that carry content and a signature, newest age first."""
    ages = []
    for path in directory.glob('*.age'):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            if path.stat().st_size < MIN_BACKUP_BYTES:
                continue
            signature = path.with_name(path.name + '.hmac')
            if not signature.is_file() or signature.stat().st_size == 0:
                continue
        except OSError:
            continue
        age = backup_time(path, now)
        if age is not None:
            ages.append(age)
    return sorted(ages)


def first_backup_grace(marker_age, tenant_age=None, grace=30 * 60):
    """Is a workspace still allowed to have no backup at all?

    Only while it is genuinely new. The rule used to look at the .initialized
    marker alone, and that file can be renewed: a workspace that had never been
    backed up stayed excused for as long as something kept touching it. The
    workspace's own age comes from the database row and cannot be touched from
    the file system; where it is unknown the marker still decides, so an older
    snapshot does not turn every workspace red.
    """
    if marker_age is None or marker_age > grace:
        return False
    return tenant_age is None or tenant_age <= grace


def recent_backup_errors(path, now):
    # Timestamped new logs; legacy un-timestamped lines use file mtime conservatively.
    modified = path.stat().st_mtime
    with path.open(errors='replace') as stream:
        for line in stream:
            if 'ERROR' not in line:
                continue
            try:
                when = dt.datetime.fromisoformat(line.split()[0].replace('Z', '+00:00')).timestamp()
            except (ValueError, IndexError):
                when = modified
            if now - when < 86400:
                return True
    return False


def recent_backup_fallbacks(path, now):
    """Count cold fallbacks in timestamped or conservatively mtime-stamped logs."""
    modified = path.stat().st_mtime
    count = 0
    with path.open(errors='replace') as stream:
        for line in stream:
            if 'BACKUP FALLBACK' not in line:
                continue
            try:
                when = dt.datetime.fromisoformat(line.split()[0].replace('Z', '+00:00')).timestamp()
            except (ValueError, IndexError):
                when = modified
            if now - when < 86400:
                count += 1
    return count


def checks():
    now = time.time()
    results = {}
    def check(label, fn):
        try:
            ok, detail = fn()
            results[label] = {'ok': bool(ok), 'detail': detail}
        except Exception:
            results[label] = {'ok': False, 'detail': 'Prüfung fehlgeschlagen; Verbindung/Konfiguration lokal prüfen'}
    base = os.environ.get('WATCHDOG_TEST_URL', 'https://bookhost.co/healthz')
    # healthz only runs SELECT 1, so it says nothing about whether customers can
    # actually sign in. The sign-in page has to render its form as well.
    login_probe = base.replace('/healthz', '/login')
    check(LABELS[0], lambda: (
        http(base, True) and http(login_probe, contains='name="password"'),
        'HTTP 200, db=true, <5s, Anmeldeformular vorhanden'))
    # The public demo is what visitors see; follow its configured host, not a fixed one.
    demo_url = os.environ.get('DEMO_URL', 'https://demo.bookhost.co')
    check(LABELS[1], lambda: (
        http(demo_url, contains='Read-only demo of BookHost'),
        'HTTP 200 mit Demo-Banner ' + demo_url))
    try:
        db = database()
        rows = [row if isinstance(row, dict) else {'slug': row} for row in db['running']]
        running = [row['slug'] for row in rows]
        hosts = {row['slug']: row.get('host') or row['slug'] + '.wissen.app.mintapis.com' for row in rows}
        # Age of the workspace itself, from the database. A file marker can be
        # renewed; the row's creation time cannot be touched from the file system.
        created = {row['slug']: row.get('created') for row in rows}
        if any(len(host) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', host) for host in hosts.values()):
            raise ValueError('Invalid host')
        if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', slug) for slug in running):
            raise ValueError('Invalid slug')
    except Exception:
        db = None
        running = []
        created = {}
    def tenants():
        failed = []
        for slug in running:
            try:
                if http(f'https://{hosts[slug]}/login', contains='name="password"'):
                    continue
            except Exception:
                pass
            failed.append(slug)
        return db is not None and not failed, f'{len(running)} running; fehlgeschlagen: ' + (', '.join(failed) or 'keine')
    check(LABELS[2], tenants)
    check(LABELS[3], lambda: provisioning_state(db))
    def backups():
        failed = []
        pending = []
        for slug in running:
            tenant = ROOT / slug
            ages = usable_backups(tenant / 'backups', now)
            if not ages:
                marker = tenant / '.initialized'
                age = now - marker.stat().st_mtime if marker.exists() else None
                born = created.get(slug)
                if first_backup_grace(age, None if born is None else now - float(born)):
                    pending.append(f'{slug} (erstbackup ausstehend ({max(0, int((age or 0) // 60))} min))')
                else:
                    failed.append(slug)
            elif ages[0] >= 26 * 3600:
                failed.append(slug)
        errors = recent_backup_errors(ROOT / 'backup.log', now)
        fallbacks = recent_backup_fallbacks(ROOT / 'backup.log', now)
        detail = f'fehlend/veraltet: {", ".join(failed) or "keine"}'
        if pending:
            detail += '; ausstehend: ' + ', '.join(pending)
        return db is not None and not failed and not errors, detail + f'; ERROR letzte 24h={errors}; fallback cold letzte 24h={fallbacks}'
    check(LABELS[4], backups)
    def host():
        config = thresholds(capacity_limits())
        disk = disk_state(ROOT)
        percent = disk['used_percent']
        count = running_tenants()
        age = now - (ROOT / 'worker.log').stat().st_mtime
        warning = 'WARNUNG: Plattenreserve knapp; ' if percent >= config['DISK_WARN_PERCENT'] else ''
        return percent < config['DISK_FAIL_PERCENT'] and age < 180, (
            warning + f"Platte={percent:.1f}%; frei={disk['free_gib']:.1f} GiB; "
            f'laufende Tenants={count}; Worker-Log={age:.0f}s alt')
    check(LABELS[5], host)
    check(LABELS[6], lambda: (db['drafting'] == 0, f"drafting >30min: {db['drafting']}"))
    return results


def save(path, state):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as stream:
        json.dump(state, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def simulate():
    state = None
    deliveries = []
    now = time.time()
    for index, ok in enumerate([True, False, False, False, True, True]):
        state, event = transition(state, ok, now + index * 600)
        print(f'SIMULATION Lauf {index + 1}: {state["status"]}; Ereignis={event or "keines"}')
        if event:
            text = message('Test-Prüfung', state, event)
            deliveries.append(event)
            print('TEST-Empfänger (nur stdout):\n' + text)
    assert deliveries == ['failure', 'recovery']
    print('SIMULATION OK: genau eine Fehlermeldung beim zweiten Fehlerlauf und eine Erholung; keine Telegram-Anfrage')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--simulate', action='store_true')
    args = parser.parse_args()
    if args.simulate and not args.dry_run:
        parser.error('--simulate requires --dry-run')
    if os.environ.get('WATCHDOG_TEST_URL') and not args.dry_run:
        parser.error('WATCHDOG_TEST_URL requires --dry-run')
    os.umask(0o077)
    if args.dry_run:
        results = checks()
        for label, result in results.items():
            print(f'{label}: {"ok" if result["ok"] else "fail"} — {result["detail"]}')
        if args.simulate:
            simulate()
        return 0 if all(r['ok'] for r in results.values()) else 1
    ROOT.mkdir(exist_ok=True)
    with (ROOT / '.watchdog.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        path = ROOT / '.watchdog-state.json'
        # Fail closed on corrupt state: do not silently reset and duplicate alerts.
        state = json.loads(path.read_text()) if path.exists() else {}
        results = checks()
        for label, result in results.items():
            candidate, event = transition(state.get(label), result['ok'], time.time())
            print(f'{stamp(time.time())} {label}: {"ok" if result["ok"] else "fail"} — {result["detail"]}', flush=True)
            if event:
                try:
                    send(message(label, candidate, event))
                except Exception:
                    print(f'{stamp(time.time())} Telegram-Zustellung fehlgeschlagen: {label}; nächster Lauf versucht erneut', flush=True)
                    continue
            state[label] = candidate
            save(path, state)
        return 0 if all(r['ok'] for r in results.values()) else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(f'{stamp(time.time())} Watchdog konnte nicht abgeschlossen werden; lokale Konfiguration/Zustandsdatei prüfen', flush=True)
        raise SystemExit(2)
