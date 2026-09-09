#!/usr/bin/env python3
"""Idempotent tenant API bootstrap. Both .env credential values use AES-256-GCM."""
import base64
import fcntl
import os
from pathlib import Path
import secrets
import shlex
import sys
import urllib.request
import urllib.error
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


def api_valid(slug, ident, secret):
    request = urllib.request.Request(f'https://{slug}.wissen.app.mintapis.com/api/books?count=1', headers={'Authorization': f'Token {ident}:{secret}'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status == 200
    except urllib.error.HTTPError as error:
        if error.code in (401, 403): return False
        raise RuntimeError('Tenant API unavailable') from None


def ensure_token(slug, rotate=False):
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
        old_ident = None
        if values.get('BOOKSTACK_API_ID') and values.get('BOOKSTACK_API_SECRET'):
            old_ident = decrypt(values['BOOKSTACK_API_ID'], slug, key)
            old_secret = decrypt(values['BOOKSTACK_API_SECRET'], slug, key)
            service = php(path, r"""
$v=json_decode(stream_get_contents(STDIN),true);
$t=BookStack\Api\ApiToken::where('token_id',$v['id'])->first();
if ($t && $t->user->system_name === 'wissen-intake') {
$u=$t->user;
$role=BookStack\Users\Models\Role::where('system_name','wissen-intake')->first()
    ?? $u->roles()->where('display_name','BookHost Intake')->first()
    ?? new BookStack\Users\Models\Role();
$role->forceFill(['system_name'=>'wissen-intake','display_name'=>'BookHost Intake','description'=>'Team-wide reviewed document intake; read destinations, create books/pages and provision member logins.']); $role->save();
$names=['access-api','book-view-all','book-create-all','chapter-view-all','page-view-all','page-create-all','page-update-all','users-manage','user-roles-manage'];
$permissions=BookStack\Permissions\Models\RolePermission::whereIn('name',$names)->pluck('id');
if(count($permissions)!==count($names)) throw new RuntimeException('Missing intake permissions');
$role->permissions()->sync($permissions); $u->roles()->sync([$role->id]);
app(BookStack\Permissions\JointPermissionBuilder::class)->rebuildForAll();
echo 'service';
} else { echo 'legacy'; }
""", {'id': old_ident})
            if not rotate and service.strip() == b'service' and api_valid(slug, old_ident, old_secret):
                return old_ident, values['BOOKSTACK_API_SECRET']
        ident, secret = secrets.token_hex(16), secrets.token_hex(16)
        php(path, r"""
$v=json_decode(stream_get_contents(STDIN),true);
Illuminate\Support\Facades\DB::transaction(function() use ($v) {
$u=BookStack\Users\Models\User::where('system_name','wissen-intake')->first();
if (!$u) $u=new BookStack\Users\Models\User();
$u->forceFill(['name'=>'BookHost Intake','email'=>'wissen-intake@invalid.local','system_name'=>'wissen-intake','password'=>'','email_confirmed'=>true]);
$u->save();
$role=BookStack\Users\Models\Role::firstOrNew(['system_name'=>'wissen-intake']);
$role->forceFill(['system_name'=>'wissen-intake','display_name'=>'BookHost Intake','description'=>'Team-wide reviewed document intake; read destinations, create books/pages and provision member logins.']); $role->save();
$names=['access-api','book-view-all','book-create-all','chapter-view-all','page-view-all','page-create-all','page-update-all','users-manage','user-roles-manage'];
$permissions=BookStack\Permissions\Models\RolePermission::whereIn('name',$names)->pluck('id');
if(count($permissions)!==count($names)) throw new RuntimeException('Missing intake permissions');
$role->permissions()->sync($permissions); $u->roles()->sync([$role->id]);
BookStack\Api\ApiToken::where('user_id',$u->id)->orWhere('token_id',$v['old_id'])->delete();
$t=(new BookStack\Api\ApiToken())->forceFill(['name'=>'BookHost reviewed document intake','token_id'=>$v['id'],'secret'=>Illuminate\Support\Facades\Hash::make($v['secret']),'user_id'=>$u->id,'expires_at'=>BookStack\Api\ApiToken::defaultExpiry()]); $t->save();
});
app(BookStack\Permissions\JointPermissionBuilder::class)->rebuildForAll();
""", {'old_id': old_ident, 'id': ident, 'secret': secret})
        values['BOOKSTACK_API_ID'] = encrypt(ident, slug, key)
        values['BOOKSTACK_API_SECRET'] = encrypt(secret, slug, key)
        tmp = path / '.env.intake.tmp'
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(''.join(k + '=' + shlex.quote(v) + '\n' for k, v in values.items()))
            stream.flush(); os.fsync(stream.fileno())
        tmp.replace(path / '.env'); (path / '.env').chmod(0o600)
        return ident, values['BOOKSTACK_API_SECRET']


def store_token(db, tenant_id, slug, rotate=False):
    ident, encrypted = ensure_token(slug, rotate)
    db.execute('INSERT INTO tenant_secrets(tenant_id,api_id,api_secret_enc) VALUES(%s,%s,%s) ON CONFLICT(tenant_id) DO UPDATE SET api_id=EXCLUDED.api_id,api_secret_enc=EXCLUDED.api_secret_enc,updated_at=now()', (tenant_id, ident, encrypted))


if __name__ == '__main__':
    try:
        rotate = '--rotate' in sys.argv
        args = [arg for arg in sys.argv[1:] if arg != '--rotate']
        if len(args) != 1:
            raise ValueError('Usage: bookstack-api-token.sh [--rotate] <slug>')
        import psycopg
        with psycopg.connect(env_read(Path('/home/flori/ventures2/bookstack/work/.app.env'))['DATABASE_URL_LOCAL']) as db:
            row = db.execute('SELECT id FROM tenants WHERE slug=%s', (args[0],)).fetchone()
            if not row:
                raise ValueError('Unknown tenant')
            store_token(db, row[0], args[0], rotate)
        print('Tenant API token ready; credentials withheld.')
    except Exception:
        print('Tenant API bootstrap failed; check migration 010, KMS configuration and admin role locally. Credentials withheld.', file=sys.stderr)
        sys.exit(1)
