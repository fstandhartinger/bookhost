#!/usr/bin/env python3
"""App-scoped immutable release pointer switch, NOT legacy checkout bootstrap.

No git checkout/fetch, no scheduler changes, no process signals or tenant operations.
Retain both releases: existing readers keep their resolved directory for their lifetime.
"""
import argparse, fcntl, os, pathlib, re, subprocess, uuid
CONSUMERS=('ops/provisioner/run-worker.sh','ops/provisioner/backup-all.sh',
           'ops/provisioner/purge-all.sh','ops/provisioner/offsite-sync.sh','ops/watchdog/run.sh')

def git(root,*args):
    return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()

def activate(active, releases, candidate, expected, target):
    active=pathlib.Path(active).absolute(); releases=pathlib.Path(releases).resolve();candidate=pathlib.Path(candidate).resolve()
    for sha in (expected,target):
        if not re.fullmatch('[0-9a-f]{40}',sha):raise ValueError('Full lowercase commit SHA required')
    # Stable app-scoped inode outside the pointer/release directories.
    with (active.parent/('.'+active.name+'.update.lock')).open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if not active.is_symlink():raise ValueError('Legacy directory: reviewed bootstrap/drain required; not safe to checkout')
        current=active.resolve(strict=True)
        for path,sha in ((current,expected),(candidate,target)):
            if path.parent!=releases or path==releases:raise ValueError('Release outside app scope')
            if git(path,'rev-parse','HEAD')!=sha:raise ValueError('Unexpected release SHA')
            if git(path,'status','--porcelain','--untracked-files=all'):raise ValueError('Dirty release refused')
        if current==candidate:return
        # No tenant-host/control-plane migrations in this release lane.
        changes=git(candidate,'diff','--name-only',expected,target).splitlines()
        if any(not p.startswith('ops/') for p in changes):raise ValueError('Non-ops change: separate release gate')
        for rel in CONSUMERS:
            a=(current/rel).read_bytes();b=(candidate/rel).read_bytes()
            if a!=b or b'readlink -f "$0"' not in a:
                raise ValueError('Consumer launcher changed: separate bootstrap gate')
        # Other shell helpers must also stay byte-identical across pointer switch.
        shells=set(git(current,'ls-files','ops/*.sh','ops/**/*.sh').splitlines())|set(git(candidate,'ls-files','ops/*.sh','ops/**/*.sh').splitlines())
        for rel in shells:
            if not (current/rel).exists() or not (candidate/rel).exists() or (current/rel).read_bytes()!=(candidate/rel).read_bytes():
                raise ValueError('Shell helper changed: separate release gate')
        for rel in ('ops/provisioner/limits.env',):
            if (current/rel).exists()!=(candidate/rel).exists() or ((current/rel).exists() and (current/rel).read_bytes()!=(candidate/rel).read_bytes()):
                raise ValueError('Runtime config differs')
        # venv is external, shared and frozen; never copy credentials into releases.
        rel='ops/provisioner/.venv'
        if (current/rel).exists() or (candidate/rel).exists():
            if not (current/rel).is_symlink() or not (candidate/rel).is_symlink() or (current/rel).resolve()!=(candidate/rel).resolve():
                raise ValueError('Runtime interpreter must be the same frozen external symlink')
        temp=active.parent/('.'+active.name+'.next-'+uuid.uuid4().hex)
        try:
            temp.symlink_to(candidate)
            os.replace(temp,active)
            fd=os.open(active.parent,os.O_DIRECTORY)
            try:os.fsync(fd)
            finally:os.close(fd)
            if active.resolve()!=candidate:raise RuntimeError('Pointer readback mismatch')
        finally:temp.unlink(missing_ok=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--active',required=True);parser.add_argument('--releases',required=True)
    parser.add_argument('--candidate',required=True);parser.add_argument('--expected',required=True);parser.add_argument('--target',required=True)
    args=parser.parse_args()
    activate(args.active,args.releases,args.candidate,args.expected,args.target)
    print('ACTIVE '+args.target)
