"""Compatibility shim. Quota helpers live in notes.media_quota."""

from .media_quota import *  # noqa: F403
from .media_quota import (  # noqa: F401
    StorageQuotaExceeded,
    apply_purge,
    assert_can_store,
    build_storage_report,
    delete_stored_file,
    format_bytes,
    plan_unreferenced_media,
    stored_file_bytes,
)
