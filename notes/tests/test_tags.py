import os
import unittest

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'project.settings')

import django

django.setup()

from notes.tags import extract_tags_from_markdown


class ExtractTagsTests(unittest.TestCase):
    def test_brace_syntax(self):
        tags = extract_tags_from_markdown('{tag: WLAN}{tag: Haefely}')
        self.assertEqual(tags, {'wlan', 'haefely'})

    def test_bracket_and_hashtag(self):
        tags = extract_tags_from_markdown('Hello #demo and [tag:Beta]')
        self.assertEqual(tags, {'demo', 'beta'})

    def test_mixed_syntax(self):
        tags = extract_tags_from_markdown('#alpha {tag: WLAN} [tag:Gamma]')
        self.assertEqual(tags, {'alpha', 'wlan', 'gamma'})


if __name__ == '__main__':
    unittest.main()
