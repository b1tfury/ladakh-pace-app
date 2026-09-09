"""Ensure Ladakh Marathon GPX is available; never crash the app."""
from __future__ import annotations

import base64
import gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GPX_PATH = ROOT / "data" / "ladakh-marathon-full.gpx"


def ensure_full_gpx() -> Path:
    """Prefer an on-disk GPX. Optionally inflate sidecar; fall back on any failure."""
    if GPX_PATH.exists() and GPX_PATH.stat().st_size > 5000:
        return GPX_PATH

    b64_path = ROOT / "data" / "ladakh-marathon-full.gpx.gz.b64"
    if b64_path.exists():
        try:
            raw = base64.b64decode("".join(b64_path.read_text().split()), validate=False)
            GPX_PATH.write_bytes(gzip.decompress(raw))
            if GPX_PATH.stat().st_size > 5000:
                return GPX_PATH
        except Exception:
            pass

    parts = sorted((ROOT / "data").glob("gpx_chunk_*.txt"))
    if parts:
        GPX_PATH.write_text("".join(part.read_text() for part in parts), encoding="utf-8")

    if not GPX_PATH.exists():
        raise FileNotFoundError(f"No GPX found under {ROOT / 'data'}")
    return GPX_PATH
