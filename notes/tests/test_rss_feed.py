from django.test import SimpleTestCase

from notes.rss_feed import normalize_feed_url, parse_feed_xml, strip_html


SAMPLE_RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Demo Feed</title>
    <link>https://example.com/</link>
    <description>Sample channel</description>
    <item>
      <title>First story</title>
      <link>https://example.com/a</link>
      <description>Hello &lt;b&gt;world&lt;/b&gt; from RSS</description>
      <media:thumbnail url="https://example.com/thumb-a.jpg" width="240" height="135"/>
      <pubDate>Mon, 01 Jul 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second story</title>
      <link>https://example.com/b</link>
      <description>More news with &lt;img src="https://example.com/inline.png" /&gt; picture</description>
      <enclosure url="https://example.com/audio.mp3" type="audio/mpeg" length="100"/>
    </item>
  </channel>
</rss>
"""

SAMPLE_ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Demo</title>
  <link href="https://example.com/atom" rel="alternate"/>
  <subtitle>Atom channel</subtitle>
  <entry>
    <title>Atom item</title>
    <link href="https://example.com/atom/1"/>
    <summary>Atom summary text</summary>
    <updated>2026-07-01T12:00:00Z</updated>
  </entry>
</feed>
"""


class RssFeedTests(SimpleTestCase):
    def test_normalize_rejects_non_http(self):
        with self.assertRaises(ValueError):
            normalize_feed_url('file:///etc/passwd')

    def test_strip_html(self):
        self.assertEqual(strip_html('<p>Hi <b>there</b></p>'), 'Hi there')

    def test_parse_rss(self):
        data = parse_feed_xml(SAMPLE_RSS)
        self.assertEqual(data['channel']['title'], 'Demo Feed')
        self.assertEqual(len(data['items']), 2)
        self.assertEqual(data['items'][0]['title'], 'First story')
        self.assertEqual(data['items'][0]['link'], 'https://example.com/a')
        self.assertIn('Hello world', data['items'][0]['description'])
        self.assertEqual(data['items'][0]['image'], 'https://example.com/thumb-a.jpg')
        self.assertEqual(data['items'][1]['image'], 'https://example.com/inline.png')

    def test_parse_atom(self):
        data = parse_feed_xml(SAMPLE_ATOM)
        self.assertEqual(data['channel']['title'], 'Atom Demo')
        self.assertEqual(data['channel']['link'], 'https://example.com/atom')
        self.assertEqual(data['items'][0]['title'], 'Atom item')
        self.assertEqual(data['items'][0]['link'], 'https://example.com/atom/1')
