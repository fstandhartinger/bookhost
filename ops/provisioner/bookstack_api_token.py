#!/usr/bin/env python3
"""Idempotent tenant API bootstrap. Both .env credential values use AES-256-GCM."""
import base64
import fcntl
import os
from pathlib import Path
import secrets
import shlex
import sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from tenant import ROOT, env_read, valid_slug, php

KEY_FILE = Path('/home/flori/ventures2/bookstack/work/.intake.env')


def kms_key():
    value = os.environ.get('INTAKE_KMS_KEY') or env_read(KEY_FILE).get('INTAKE_KMS_KEY', '')
    if len(value) != 64:
        raise ValueError('INTAKE_KMS_KEY must contain 32 hex-encoded bytes')
    return bytes.fromhex(value)


def encrypt(value, slug, key):
    nonce = secrets.token_bytes(12)
    return 'v1:' + base64.b64encode(nonce + AESGCM(key).encrypt(nonce, value.encode(), slug.encode())).decode()


def decrypt(value, slug, key):
    if not value.startswith('v1:'):
        raise ValueError('Invalid encrypted credential')
    raw = base64.b64decode(value[3:])
    return AESGCM(key).decrypt(raw[:12], raw[12:], slug.encode()).decode()


def ensure_token(slug):
    if not valid_slug(slug) and slug != 'demo':
        raise ValueError('Invalid tenant')
    path = ROOT / slug
    if path.is_symlink() or not (path / '.initialized').exists():
        raise ValueError('Tenant is not initialized')
    key = kms_key()
    locks = ROOT / '.locks'
    locks.mkdir(exist_ok=True)
    with (locks / (slug + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        values = env_read(path / '.env')
        if values.get('BOOKSTACK_API_ID') and values.get('BOOKSTACK_API_SECRET'):
            ident = decrypt(values['BOOKSTACK_API_ID'], slug, key)
            secret = decrypt(values['BOOKSTACK_API_SECRET'], slug, key)
        else:
            ident, secret = secrets.token_hex(16), secrets.token_hex(16)
            # Persist first: a process crash can safely resume with the same token.
            values['BOOKSTACK_API_ID'] = encrypt(ident, slug, key)
            values['BOOKSTACK_API_SECRET'] = encrypt(secret, slug, key)
            tmp = path / '.env.intake.tmp'
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w') as stream:
                stream.write(''.join(k + '=' + shlex.quote(v) + '\n' for k, v in values.items()))
                stream.flush()
                os.fsync(stream.fileno())
            tmp.replace(path / '.env')
            (path / '.env').chmod(0o600)
        php(path, r"""
$v=json_decode(stream_get_contents(STDIN),true);
$u=BookStack\Users\Models\User::where('email',$v['email'])->firstOrFail();
$role=$u->roles()->where('system_name','admin')->firstOrFail();
$permission=BookStack\Permissions\Models\RolePermission::where('name','access-api')->firstOrFail();
$role->permissions()->syncWithoutDetaching([$permission->id]);
$t=BookStack\Api\ApiToken::where('token_id',$v['id'])->first();
if (!$t) {
  $t=(new BookStack\Api\ApiToken())->forceFill(['name'=>'Wissen reviewed document intake','token_id'=>$v['id'],'secret'=>Illuminate\Support\Facades\Hash::make($v['secret']),'user_id'=>$u->id,'expires_at'=>BookStack\Api\ApiToken::defaultExpiry()]);
  $t->save();
} elseif ($t->user_id !== $u->id || !Illuminate\Support\Facades\Hash::check($v['secret'],$t->secret)) { throw new RuntimeException('Token mismatch'); }
""", {'email': values['BOOKSTACK_ADMIN_EMAIL'], 'id': ident, 'secret': secret})
        return ident, values['BOOKSTACK_API_SECRET']


def store_token(db, tenant_id, slug):
    ident, encrypted = ensure_token(slug)
    db.execute('INSERT INTO tenant_secrets(tenant_id,api_id,api_secret_enc) VALUES(%s,%s,%s) ON CONFLICT(tenant_id) DO UPDATE SET api_id=EXCLUDED.api_id,api_secret_enc=EXCLUDED.api_secret_enc,updated_at=now()', (tenant_id, ident, encrypted))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Usage: bookstack-api-token.sh <slug>')
        import psycopg
        with psycopg.connect(env_read(Path('/home/flori/ventures2/bookstack/work/.app.env'))['DATABASE_URL_LOCAL']) as db:
            row = db.execute('SELECT id FROM tenants WHERE slug=%s', (sys.argv[1],)).fetchone()
            if not row:
                raise ValueError('Unknown tenant')
            store_token(db, row[0], sys.argv[1])
        print('Tenant API token ready; credentials withheld.')
    except Exception:
        print('Tenant API bootstrap failed; check migration 010, KMS configuration and admin role locally. Credentials withheld.', file=sys.stderr)
        sys.exit(1)
