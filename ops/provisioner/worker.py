#!/usr/bin/env python3
import argparse, subprocess, time
import psycopg
from tenant import HERE, ROOT, env_read

def once():
    dsn=env_read(__import__('pathlib').Path('/home/flori/ventures2/bookstack/work/.app.env'))['DATABASE_URL_LOCAL']
    with psycopg.connect(dsn) as db:
        db.execute((HERE/'schema.sql').read_text())
        row=db.execute("UPDATE tenants SET status='provisioning', error=NULL, updated_at=now() WHERE id=(SELECT id FROM tenants WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,slug,admin_email").fetchone()
        db.commit()
        if not row: return
        ident,slug,email=row
        try:
            args=[str(HERE/'provision.sh'),slug]
            if email: args.append(email)
            result=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=1500)
            if result.returncode: raise RuntimeError('Provisioning command failed; inspect tenant locally')
            values=env_read(ROOT/slug/'.env')
            db.execute("UPDATE tenants SET status='running',bookstack_url=%s,initial_password=%s,error=NULL,updated_at=now() WHERE id=%s AND status='provisioning'",(values['APP_URL'],values['BOOKSTACK_ADMIN_PASSWORD'],ident))
            print('Tenant running',flush=True)
        except Exception:
            db.execute("UPDATE tenants SET status='failed',error=%s,updated_at=now() WHERE id=%s AND status='provisioning'",('Provisioning failed; inspect tenant locally and retry pending',ident))
            print('Tenant failed; diagnostic output withheld to protect credentials',flush=True)
        db.commit()

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--once',action='store_true'); p.add_argument('--cron',action='store_true'); args=p.parse_args()
    start=time.monotonic()
    while True:
        try: once()
        except Exception: print('Worker database/configuration failure; details withheld',flush=True); raise SystemExit(1)
        if args.once or (args.cron and time.monotonic()-start>=30): break
        time.sleep(30)
