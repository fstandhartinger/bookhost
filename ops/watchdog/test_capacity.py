import tempfile
import unittest
from pathlib import Path
from collections import namedtuple
from unittest.mock import patch
import watchdog as w

class DiskWarnings(unittest.TestCase):
    def test_warning_failure_and_config(self):
        disk = namedtuple('Disk','total used free')
        for percent, config, ok, warning in [(79,{},True,False),(80,{},True,True),(82,{},True,True),(90,{},False,True),(91,{},False,True),(82,{'DISK_WARN_PERCENT':'83','DISK_FAIL_PERCENT':'95'},True,False)]:
            with self.subTest(percent=percent,config=config), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); (root/'worker.log').touch()
                with patch.object(w,'ROOT',root), patch.object(w,'http',return_value=True), patch.object(w,'database',return_value={'running':[],'pending':0,'provisioning':0,'drafting':0}), patch.object(w.shutil,'disk_usage',return_value=disk(110*1024**3,percent*1024**3,(100-percent)*1024**3)), patch.object(w,'capacity_limits',return_value=config,create=True), patch.object(w,'running_tenants',return_value=3,create=True):
                    host=w.checks()['Host und Worker']
                self.assertEqual(host['ok'],ok)
                self.assertEqual('WARNUNG' in host['detail'],warning)
                self.assertIn('laufende Tenants=3',host['detail'])
                self.assertIn(f'frei={100-percent:.1f} GiB',host['detail'])
