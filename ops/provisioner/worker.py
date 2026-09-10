#!/usr/bin/env python3
"""Serialized lifecycle reconciliation; diagnostics never contain credentials."""
import argparse
import os
import signal
import subprocess
import time
import sys
from pathlib import Path
from urllib.parse import urlsplit
import psycopg
from tenant import HERE, ROOT, env_read, valid_slug, compose
from bookstack_api_token import store_token

DEFAULT_RESERVED_TEST_PREFIXES = ('rc-', 'fb-', 'nh-', 'dom-', 'bh-', 'tmp-', 'test-')

def limits():
    """Operator config is untracked; a missing file must fall back to defaults."""
    path=HERE/'limits.env'
    return env_read(path) if path.exists() else {}


def reserved_test_prefixes():
    raw = limits().get('RESERVED_TEST_PREFIXES', ','.join(DEFAULT_RESERVED_TEST_PREFIXES))
    return tuple(prefix.strip() for prefix in raw.split(',') if prefix.strip())

def is_reserved_test_slug(slug):
    return slug.startswith(reserved_test_prefixes())


def command(action, slug, email=None):
    args=[sys.executable,str(HERE/'tenant.py'),action,slug]
    if email: args.append(email)
    process=subprocess.Popen(['timeout','--kill-after=20s','1100s',*args],
                             start_new_session=True, stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        code=process.wait(timeout=1130)
        if code: raise RuntimeError('Lifecycle command failed')
    except BaseException:
        try: os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL); process.wait()
        raise


def capacity():
    values=limits()
    limit=int(values.get('MAX_TENANTS','15'))
    free=int(subprocess.check_output(['df','-B1','--output=avail',str(ROOT)],text=True).splitlines()[-1])
    names=subprocess.check_output(['sudo','-n','docker','ps','--filter','label=com.docker.compose.service=bookstack','--format','{{.Names}}'],text=True).splitlines()
    count=sum(name.startswith('wissen-') and not name.startswith('wissen-restore-') for name in names)
    if free >= 20*1024**3 and count < limit: return True
    marker=ROOT/'.capacity-notice'
    if not marker.exists() or time.time()-marker.stat().st_mtime >= 3600:
        print(f'Capacity: pending retained; running={count}, MAX_TENANTS={limit}, free_GiB={free//1024**3}',flush=True)
        marker.touch()
    return False


def once():
    dsn=env_read(Path('/home/flori/ventures2/bookstack/work/.app.env'))['DATABASE_URL_LOCAL']
    with psycopg.connect(dsn,autocommit=True) as db:
        db.execute((HERE/'schema.sql').read_text())
        # run-worker.sh flock spans the whole command: no live worker is reclaimed.
        stale=db.execute("SELECT id,slug FROM tenants WHERE status='provisioning' AND updated_at < now()-interval '20 minutes'").fetchall()
        for ident,slug in stale:
            try:
                if valid_slug(slug) or slug=='demo':
                    if (ROOT/slug/'docker-compose.yml').exists(): command('deprovision',slug)
            except Exception:
                print('Timeout cleanup failed; retry next run',flush=True); continue
            db.execute("UPDATE tenants SET status='failed',error='timeout',updated_at=now() WHERE id=%s AND status='provisioning'",(ident,))
        rows=db.execute("SELECT id,slug,admin_email,status,desired_state,provisioner_instance FROM tenants WHERE status IN ('pending','running','suspended') ORDER BY created_at").fetchall()
        instance = os.environ.get('PROVISIONER_INSTANCE', 'production')
        for tenant_row in rows:
            ident,slug,email,status,desired = tenant_row[:5]
            provisioner_instance = tenant_row[5] if len(tenant_row) > 5 else None
            if provisioner_instance is not None and provisioner_instance != instance:
                print('Tenant skipped; provisioner instance mismatch: '+slug,flush=True)
                continue
            if status == 'pending' and is_reserved_test_slug(slug):
                db.execute("UPDATE tenants SET status='failed',error='Reserved test slug; provision manually in an isolated checkout',updated_at=now() WHERE id=%s AND status='pending'",(ident,))
                print('Tenant rejected; reserved test slug: '+slug,flush=True)
                continue
            existing=(ROOT/slug/'.initialized').exists() if valid_slug(slug) or slug=='demo' else False
            # Existing operator-owned demo is allowed only for lifecycle actions.
            if not valid_slug(slug) and not (slug=='demo' and existing and status!='pending'):
                if status=='pending':
                    db.execute("UPDATE tenants SET status='failed',error='Invalid or reserved slug: use 3-30 lowercase letters/digits, single hyphens, no restore prefix',updated_at=now() WHERE id=%s AND status='pending'",(ident,))
                continue
            path=ROOT/slug
            if desired=='suspended' or (path/'.destroy_requested_at').exists() or (ROOT/'.destroy-requests'/slug).exists():
                try:
                    if (path/'docker-compose.yml').exists(): command('deprovision',slug)
                    db.execute("UPDATE tenants SET status='suspended',error=NULL,updated_at=now() WHERE id=%s AND status IN ('running','pending','suspended')",(ident,))
                except Exception: print('Suspend failed; retry next run',flush=True)
                continue
            # Honor legacy status=suspended before resume, also stopping any remnants.
            if status=='suspended' and (path/'docker-compose.yml').exists(): command('deprovision',slug)
            if status not in ('pending','suspended'): continue
            if not capacity(): continue
            row=db.execute("UPDATE tenants SET status='provisioning',error=NULL,updated_at=now() WHERE id=%s AND status=%s AND desired_state='running' RETURNING id",(ident,status)).fetchone()
            if not row: continue
            try:
                command('provision',slug,email)
                try:
                    store_token(db, ident, slug)
                except Exception:
                    print("Intake token setup failed; healthy tenant remains available", flush=True)
                values=env_read(path/'.env')
                # The persisted APP_URL also preserves legacy hosts on resume.
                host=urlsplit(values['APP_URL']).hostname
                if existing:
                    db.execute("UPDATE tenants SET status='running',host=%s,bookstack_url=%s,error=NULL,updated_at=now() WHERE id=%s AND status='provisioning'",(host,values['APP_URL'],ident))
                else:
                    db.execute("UPDATE tenants SET status='running',host=%s,bookstack_url=%s,initial_password=%s,error=NULL,updated_at=now() WHERE id=%s AND status='provisioning'",(host,values['APP_URL'],values['BOOKSTACK_ADMIN_PASSWORD'],ident))
                # Billing may change desired_state while provision runs; next pass reconciles.
                print('Tenant running: '+slug,flush=True)
            except Exception:
                try:
                    if (path/'docker-compose.yml').exists(): command('deprovision',slug)
                finally:
                    db.execute("UPDATE tenants SET status='failed',error='Provisioning failed; inspect tenant locally and retry pending',updated_at=now() WHERE id=%s AND status='provisioning'",(ident,))
                print('Tenant failed; diagnostics withheld',flush=True)
            return


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--once',action='store_true'); p.add_argument('--cron',action='store_true'); args=p.parse_args()
    start=time.monotonic()
    while True:
        try:
            once()
            print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " Worker check completed", flush=True)
        except Exception:
            print('Worker database/configuration failure; details withheld',flush=True); raise SystemExit(1)
        if args.once or (args.cron and time.monotonic()-start>=30): break
        time.sleep(30)
