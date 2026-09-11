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

    def test_ignores_hashtag_and_bracket(self):
        tags = extract_tags_from_markdown('Hello #demo and [tag:Beta]')
        self.assertEqual(tags, set())

    def test_heading_counts_as_tag(self):
        tags = extract_tags_from_markdown('# Alpha\nsome text')
        self.assertEqual(tags, {'alpha'})

    def test_heading_and_brace_both_count(self):
        tags = extract_tags_from_markdown('# alpha\n{tag: WLAN} [tag:Gamma]')
        self.assertEqual(tags, {'alpha', 'wlan'})


if __name__ == '__main__':
    unittest.main()
