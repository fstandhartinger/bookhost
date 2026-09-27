import unittest

from publish import CANONICAL_APP_URL, valid_showcase_app_url


class ShowcaseUrlTest(unittest.TestCase):
    def test_accepts_the_exact_showcase_url(self):
        self.assertTrue(valid_showcase_app_url(CANONICAL_APP_URL))

    def test_rejects_other_hosts_and_url_components(self):
        rejected = (
            'https://showcase-northwind.attacker.example',
            'https://showcase-northwind-2.bookhost.co',
            'http://showcase-northwind.bookhost.co',
            'https://showcase-northwind.bookhost.co:443',
            'https://user@showcase-northwind.bookhost.co',
            'https://showcase-northwind.bookhost.co/other',
            'https://showcase-northwind.bookhost.co?next=other',
            'https://showcase-northwind.bookhost.co#other',
            '',
        )
        for app_url in rejected:
            with self.subTest(app_url=app_url):
                self.assertFalse(valid_showcase_app_url(app_url))


if __name__ == '__main__':
    unittest.main()
