import importlib.util, pathlib, subprocess, tempfile, unittest, os
HERE=pathlib.Path(__file__).resolve().parent

class AtomicTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=pathlib.Path(self.tmp.name);self.releases=self.root/'releases';self.releases.mkdir()
        self.old=self.releases/'old';self.old.mkdir()
        self.git(self.old,'init','-q');self.git(self.old,'config','user.email','fixture@example.invalid');self.git(self.old,'config','user.name','fixture')
        for rel in ['ops/provisioner/run-worker.sh','ops/provisioner/backup-all.sh','ops/provisioner/purge-all.sh','ops/provisioner/offsite-sync.sh','ops/watchdog/run.sh']:
            p=self.old/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('#!/bin/bash\nhere=$(dirname "$(readlink -f "$0")")\n')
        (self.old/'ops/provisioner/tenant.py').write_text('version=1\n')
        self.git(self.old,'add','.');self.git(self.old,'commit','-qm','old')
        self.before=self.git(self.old,'rev-parse','HEAD')
        self.new=self.releases/'new';self.git(self.root,'clone','-q',str(self.old),str(self.new))
        self.git(self.new,'config','user.email','fixture@example.invalid');self.git(self.new,'config','user.name','fixture')
        (self.new/'ops/provisioner/tenant.py').write_text('version=2\n')
        self.git(self.new,'add','.');self.git(self.new,'commit','-qm','new');self.after=self.git(self.new,'rev-parse','HEAD')
        self.active=self.root/'active';self.active.symlink_to(self.old)
    def git(self,path,*args):return subprocess.check_output(['git','-C',str(path),*args],text=True).strip()
    def switch(self):
        spec=importlib.util.spec_from_file_location('atomic',HERE/'atomic_provisioner.py')
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        mod.activate(self.active,self.releases,self.new,self.before,self.after)
    def test_atomic_switch_keeps_old_reader_pinned(self):
        reader=(self.active/'ops/provisioner/tenant.py').resolve()
        self.switch()
        self.assertEqual(self.active.resolve(),self.new)
        self.assertEqual(reader.read_text(),'version=1\n')
    def test_all_five_consumers_keep_pinned_release_during_switch(self):
        processes=[]
        try:
            # Launch real Bash processes using the same physical-directory resolution
            # as every current production launcher; payload is fixture-only.
            for rel in ['ops/provisioner/run-worker.sh','ops/provisioner/backup-all.sh','ops/provisioner/purge-all.sh','ops/provisioner/offsite-sync.sh','ops/watchdog/run.sh']:
                command='here=$(dirname "$(readlink -f "$1")"); printf "%s\\n" "$here"; read -r go; python3 -c \'import pathlib,sys;p=pathlib.Path(sys.argv[1]);print((p.parent / "provisioner" / "tenant.py").read_text().strip())\' "$here"'
                proc=subprocess.Popen(['bash','-c',command,'reader',str(self.active/rel)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
                processes.append(proc)
                self.assertTrue(proc.stdout.readline().strip().startswith(str(self.old)))
            self.switch()
            for proc in processes:
                output,_=proc.communicate('\n',timeout=5)
                self.assertEqual(proc.returncode,0)
                self.assertEqual(output.strip(),'version=1')
            self.assertEqual((self.active/'ops/provisioner/tenant.py').read_text(),'version=2\n')
        finally:
            for proc in processes:
                if proc.poll() is None:proc.kill();proc.wait()
    def test_dirty_current_refused(self):
        (self.old/'unexpected').write_text('dirty')
        with self.assertRaises(ValueError): self.switch()
        self.assertEqual(self.active.resolve(),self.old)
    def test_dirty_candidate_refused(self):
        (self.new/'unexpected').write_text('dirty')
        with self.assertRaises(ValueError): self.switch()
    def test_unpinned_sha_refused(self):
        self.after=self.after[:7]
        with self.assertRaises(ValueError):self.switch()
    def test_legacy_directory_requires_bootstrap(self):
        self.active.unlink();self.active.mkdir()
        with self.assertRaises(ValueError):self.switch()
    def test_wrong_expected_current_refused(self):
        self.before='0'*40
        with self.assertRaises(ValueError):self.switch()
    def test_migration_not_part_of_ops_release(self):
        p=self.new/'migrations';p.mkdir();(p/'021.sql').write_text('migration')
        self.git(self.new,'add','.');self.git(self.new,'commit','-qm','migration');self.after=self.git(self.new,'rev-parse','HEAD')
        with self.assertRaises(ValueError):self.switch()
    def test_changed_wrapper_requires_separate_bootstrap(self):
        (self.new/'ops/provisioner/backup-all.sh').write_text('changed')
        self.git(self.new,'add','.');self.git(self.new,'commit','-qm','wrapper');self.after=self.git(self.new,'rev-parse','HEAD')
        with self.assertRaises(ValueError):self.switch()

if __name__=='__main__':unittest.main()
