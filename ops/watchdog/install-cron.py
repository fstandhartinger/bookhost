#!/usr/bin/env python3
"""Install just our marked cron entry, preserving all unrelated jobs."""
from pathlib import Path
import subprocess

root = Path('/home/flori/ventures2/bookstack/tenants')
root.mkdir(mode=0o700, exist_ok=True)
runner = Path(__file__).resolve().with_name('run.sh')
result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
if result.returncode and 'no crontab for' not in result.stderr:
    raise SystemExit('Cannot read crontab; refusing to replace it')
lines = [line for line in result.stdout.splitlines() if not line.rstrip().endswith('# wissen-watchdog')]
lines.append(f'*/10 * * * * {runner} >> {root}/watchdog.log 2>&1 # wissen-watchdog')
subprocess.run(['crontab', '-'], input='\n'.join(lines) + '\n', text=True, check=True)
print('Installed # wissen-watchdog (every 10 minutes)')
