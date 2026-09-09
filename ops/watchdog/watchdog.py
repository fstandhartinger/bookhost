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
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path('/home/flori/ventures2/bookstack/tenants')
LOG = ROOT / 'watchdog.log'
LABELS = ['Control-Plane', 'Demo', 'Tenant-Logins', 'Bereitstellung', 'Backups', 'Host und Worker', 'Dokument-Eingang']


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
    first = (f'Wissen: {label} ausgefallen seit {state["since"]}' if event == 'failure'
             else f'Wissen: {label} wieder ok seit {state["since"]}')
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
 'running', COALESCE((SELECT json_agg(slug ORDER BY slug) FROM tenants WHERE status='running'), '[]'::json),
 'provisioning', (SELECT count(*) FROM tenants WHERE status='provisioning' AND updated_at < now()-interval '20 minutes'),
 'pending', (SELECT count(*) FROM tenants WHERE status='pending' AND created_at < now()-interval '15 minutes'),
 'drafting', (SELECT count(*) FROM intake_items WHERE status='drafting' AND updated_at < now()-interval '30 minutes'));
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


def http(url, health=False):
    start = time.monotonic()
    request = urllib.request.Request(url, headers={'User-Agent': 'Wissen-Operator-Watchdog/1.0'})
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 200:
            return False
        if health:
            body = json.loads(response.read(65536))
            return body.get('db') is True and time.monotonic() - start < 5
        return True


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


def checks():
    now = time.time()
    results = {}
    def check(label, fn):
        try:
            ok, detail = fn()
            results[label] = {'ok': bool(ok), 'detail': detail}
        except Exception:
            results[label] = {'ok': False, 'detail': 'Prüfung fehlgeschlagen; Verbindung/Konfiguration lokal prüfen'}
    check(LABELS[0], lambda: (http(os.environ.get('WATCHDOG_TEST_URL', 'https://wissen.app.mintapis.com/healthz'), True), 'HTTP 200, db=true, <5s'))
    check(LABELS[1], lambda: (http('https://demo.wissen.app.mintapis.com/'), 'HTTP 200'))
    try:
        db = database()
        running = db['running']
        if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', slug) for slug in running):
            raise ValueError('Invalid slug')
    except Exception:
        db = None
        running = []
    def tenants():
        failed = []
        for slug in running:
            try:
                if http(f'https://{slug}.wissen.app.mintapis.com/login'):
                    continue
            except Exception:
                pass
            failed.append(slug)
        return db is not None and not failed, f'{len(running)} running; fehlgeschlagen: ' + (', '.join(failed) or 'keine')
    check(LABELS[2], tenants)
    check(LABELS[3], lambda: (db['provisioning'] == 0 and db['pending'] == 0,
                            f"überfällig: provisioning={db['provisioning']}, pending={db['pending']}"))
    def backups():
        failed = []
        for slug in running:
            files = list((ROOT / slug / 'backups').glob('*.age'))
            if not files or now - max(p.stat().st_mtime for p in files) >= 26 * 3600:
                failed.append(slug)
        errors = recent_backup_errors(ROOT / 'backup.log', now)
        return db is not None and not failed and not errors, f'fehlend/veraltet: {", ".join(failed) or "keine"}; ERROR letzte 24h={errors}'
    check(LABELS[4], backups)
    def host():
        disk = shutil.disk_usage('/')
        # Match df: reserved blocks are unavailable to the service user.
        percent = disk.used / (disk.used + disk.free) * 100
        age = now - (ROOT / 'worker.log').stat().st_mtime
        return percent < 90 and age < 180, f'Platte={percent:.1f}%; Worker-Log={age:.0f}s alt'
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
