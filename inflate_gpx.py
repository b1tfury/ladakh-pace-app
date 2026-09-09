"""Inflate full Ladakh Marathon GPX from compact deploy artifacts."""
from __future__ import annotations

import base64
import gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GPX_PATH = ROOT / "data" / "ladakh-marathon-full.gpx"


def ensure_full_gpx() -> Path:
    if GPX_PATH.exists() and GPX_PATH.stat().st_size > 40000:
        return GPX_PATH
    b64_path = ROOT / "data" / "ladakh-marathon-full.gpx.gz.b64"
    if b64_path.exists():
        GPX_PATH.write_bytes(gzip.decompress(base64.b64decode(b64_path.read_text().encode("ascii"))))
        return GPX_PATH
    parts = sorted((ROOT / "data").glob("gpx_chunk_*.txt"))
    if len(parts) >= 2:
        GPX_PATH.write_text("".join(p.read_text() for p in parts), encoding="utf-8")
    return GPX_PATH
