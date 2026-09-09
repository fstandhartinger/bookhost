import unittest
from unittest.mock import patch
import watchdog

class TenantHostTests(unittest.TestCase):
    def test_login_uses_database_host_and_legacy_fallback(self):
        data = {'running': [{'slug': 'new-team', 'host': 'new-team.bookhost.co'}, {'slug': 'old-team', 'host': None}], 'pending': 0, 'provisioning': 0, 'drafting': 0}
        with patch.object(watchdog, 'database', return_value=data), patch.object(watchdog, 'http', return_value=True) as http:
            result = watchdog.checks()
        self.assertTrue(result[watchdog.LABELS[2]]['ok'])
        urls = [call.args[0] for call in http.call_args_list]
        self.assertIn('https://new-team.bookhost.co/login', urls)
        self.assertIn('https://old-team.wissen.app.mintapis.com/login', urls)
