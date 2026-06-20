import os
import tempfile
import unittest

from notes.local_files import file_url_to_path, open_in_file_manager


class FileUrlToPathTests(unittest.TestCase):
    def test_file_uri_three_slashes(self):
        self.assertEqual(
            file_url_to_path('file:///C:/Users/demo/file.pdf'),
            os.path.normpath(r'C:\Users\demo\file.pdf'),
        )

    def test_file_uri_two_slashes_windows_drive(self):
        self.assertEqual(
            file_url_to_path('file://C:/Users/demo/file.pdf'),
            os.path.normpath(r'C:\Users\demo\file.pdf'),
        )

    def test_plain_windows_path(self):
        self.assertEqual(
            file_url_to_path(r'C:\Users\demo\file.pdf'),
            os.path.normpath(r'C:\Users\demo\file.pdf'),
        )

    def test_spaces(self):
        self.assertEqual(
            file_url_to_path('file:///C:/Users/demo/My%20Docs/file.pdf'),
            os.path.normpath(r'C:\Users\demo\My Docs\file.pdf'),
        )


class OpenInFileManagerTests(unittest.TestCase):
    def test_open_existing_file(self):
        with tempfile.NamedTemporaryFile(delete=False, suffix='.txt') as tmp:
            tmp.write(b'notespro')
            path = tmp.name
        try:
            resolved = open_in_file_manager(path)
            self.assertEqual(resolved, os.path.abspath(path))
        finally:
            os.unlink(path)


if __name__ == '__main__':
    unittest.main()
