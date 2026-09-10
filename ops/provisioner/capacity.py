#!/usr/bin/env python3
"""Read-only host capacity inspection. GB configuration uses binary GiB (2**30)."""
import argparse
import json
from pathlib import Path
import shlex
import shutil
import subprocess

ROOT = Path('/home/flori/ventures2/bookstack/tenants')
LIMITS_FILE = Path(__file__).resolve().parent/'limits.env'
GIB = 1024**3
DEFAULTS = {'MIN_FREE_DISK_GB':20, 'MAX_DISK_PERCENT':85, 'MAX_TENANTS':15,
            'DISK_WARN_PERCENT':80, 'DISK_FAIL_PERCENT':90}
CUSTOMER_ERROR = 'We could not prepare your workspace right now. Please try again later or contact our team.'


def capacity_limits():
    values = {}
    if LIMITS_FILE.exists():
        for line in LIMITS_FILE.read_text().splitlines():
            parts = shlex.split(line, comments=True)
            if parts and parts[0] == 'export': parts.pop(0)
            if not parts: continue
            if len(parts) != 1 or '=' not in parts[0]: raise ValueError('Invalid limits configuration')
            key, value = parts[0].split('=',1)
            values[key] = value
    return values


def thresholds(values):
    result = {key:float(values.get(key, default)) for key,default in DEFAULTS.items()}
    if not (0 < result['DISK_WARN_PERCENT'] < result['DISK_FAIL_PERCENT'] <= 100
            and 0 < result['MAX_DISK_PERCENT'] <= 100
            and 0 <= result['MIN_FREE_DISK_GB'] < float('inf')
            and 0 < result['MAX_TENANTS'] < float('inf')
            and result['MAX_TENANTS'].is_integer()):
        raise ValueError('Invalid capacity thresholds')
    return result


def disk_state(root):
    disk = shutil.disk_usage(root)
    # Match df: total includes reserved blocks unavailable to the service user.
    usable = disk.used + disk.free
    return {'free_gib':disk.free/GIB, 'used_percent':disk.used/usable*100,
            'used_bytes':disk.used, 'usable_bytes':usable}


def running_tenants():
    names = subprocess.check_output(['sudo','-n','docker','ps','--filter',
        'label=com.docker.compose.service=bookstack','--format','{{.Names}}'],
        text=True, timeout=15).splitlines()
    return sum(name.startswith('wissen-') and not name.startswith('wissen-restore-') for name in names)


def directory_bytes(path):
    # Allocated bytes, including nested backups, without following symlinks.
    # sudo is needed for MariaDB-owned files; errors must not underreport usage.
    output = subprocess.check_output(['sudo','-n','du','-s','-B1','--',str(path)],
                                     text=True, timeout=120)
    return int(output.split()[0])


def report(root, values):
    config = thresholds(values)
    state = disk_state(root)
    tenants = [{'slug':p.name, 'bytes':directory_bytes(p)} for p in root.iterdir()
               if p.is_dir() and not p.is_symlink() and not p.name.startswith('.')
               and not p.name.startswith('restore-') and (p/'docker-compose.yml').is_file()]
    state.update(tenant_count=len(tenants), running_tenants=running_tenants(),
                 tenants=sorted(tenants,key=lambda item: (-item['bytes'],item['slug'])))
    for label in ('warn','fail'):
        state[f'reserve_{label}_gib'] = (state['usable_bytes']*config[f'DISK_{label.upper()}_PERCENT']/100-state['used_bytes'])/GIB
    state['thresholds'] = config
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--json',action='store_true')
    args = parser.parse_args()
    state = report(args.root,capacity_limits())
    if args.json:
        print(json.dumps(state,indent=2)); return
    print(f"Disk: free={state['free_gib']:.2f} GiB; used={state['used_percent']:.2f}%")
    print(f"Tenants: {state['tenant_count']} directories; {state['running_tenants']} running")
    for label in ('warn','fail'):
        print(f"Reserve to {label} ({state['thresholds'][f'DISK_{label.upper()}_PERCENT']:g}%): {state[f'reserve_{label}_gib']:.2f} GiB (negative = exceeded)")
    print('Tenant allocated size including backups, largest first:')
    for item in state['tenants']: print(f"  {item['slug']}: {item['bytes']/GIB:.3f} GiB")


if __name__ == '__main__':
    main()
