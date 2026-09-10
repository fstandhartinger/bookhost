"""Status 200 is not evidence that the right page answered."""
import io
import json
import unittest
from unittest import mock

import watchdog as w


class FakeResponse(io.BytesIO):
    def __init__(self, body=b'', status=200, url='https://bookhost.co/login'):
        super().__init__(body)
        self.status = status
        self._url = url

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def answering(response):
    return mock.patch.object(w.urllib.request, 'urlopen', return_value=response)


class HttpCheckTests(unittest.TestCase):
    def test_marker_present_is_healthy(self):
        with answering(FakeResponse(b'<input name="password">')):
            self.assertTrue(w.http('https://bookhost.co/login', contains='name="password"'))

    def test_maintenance_page_with_status_200_is_not_healthy(self):
        with answering(FakeResponse(b'<h1>We are back shortly</h1>')):
            self.assertFalse(w.http('https://bookhost.co/login', contains='name="password"'))

    def test_redirect_to_another_host_is_not_healthy(self):
        # urlopen follows redirects; the page that finally answered has to be ours.
        with answering(FakeResponse(b'<input name="password">',
                                    url='https://somewhere-else.example/login')):
            self.assertFalse(w.http('https://bookhost.co/login', contains='name="password"'))

    def test_redirect_within_the_same_host_stays_healthy(self):
        with answering(FakeResponse(b'Read-only demo of BookHost',
                                    url='https://demo.bookhost.co/books')):
            self.assertTrue(w.http('https://demo.bookhost.co/',
                                   contains='Read-only demo of BookHost'))

    def test_wrong_workspace_answering_is_not_healthy(self):
        with answering(FakeResponse(b'<input name="password">',
                                    url='https://other-tenant.bookhost.co/login')):
            self.assertFalse(w.http('https://qa-third-0910.bookhost.co/login',
                                    contains='name="password"'))

    def test_health_probe_still_requires_the_database_flag(self):
        with answering(FakeResponse(json.dumps({'ok': True, 'db': False}).encode(),
                                    url='https://bookhost.co/healthz')):
            self.assertFalse(w.http('https://bookhost.co/healthz', health=True))
        with answering(FakeResponse(json.dumps({'ok': True, 'db': True}).encode(),
                                    url='https://bookhost.co/healthz')):
            self.assertTrue(w.http('https://bookhost.co/healthz', health=True))

    def test_non_200_is_not_healthy(self):
        with answering(FakeResponse(b'<input name="password">', status=503)):
            self.assertFalse(w.http('https://bookhost.co/login', contains='name="password"'))
