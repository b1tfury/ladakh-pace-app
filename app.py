"""Ladakh Marathon pace + elevation calculator API."""
from __future__ import annotations

import math
import os
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
GPX_PATH = ROOT / "data" / "ladakh-marathon-full.gpx"
STATIC = ROOT / "static"

from inflate_gpx import ensure_full_gpx as _ensure_full_gpx

CLIMB_EQ_M_PER_KM = 100.0
DESCENT_EQ_M_PER_KM = 100.0 / 0.3
MODEL_NAME = "Naismith-inspired climb-equivalent ( +1 km flat per 100 m gain; -0.3 km per 100 m drop )"

app = FastAPI(title="Ladakh Pace", version="1.0.0")


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _smooth(values: list[float], half_window: int = 7) -> list[float]:
    out: list[float] = []
    n = len(values)
    for i in range(n):
        lo = max(0, i - half_window)
        hi = min(n, i + half_window + 1)
        out.append(sum(values[lo:hi]) / (hi - lo))
    return out


def _gain_loss(eles: list[float], threshold_m: float = 3.0) -> tuple[float, float]:
    gain = loss = 0.0
    last = eles[0]
    for e in eles[1:]:
        de = e - last
        if abs(de) >= threshold_m:
            if de > 0:
                gain += de
            else:
                loss += -de
            last = e
    return gain, loss


def parse_gpx(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(path)
    root = ET.parse(path).getroot()
    raw: list[tuple[float, float, float]] = []
    for el in root.iter():
        if not el.tag.endswith("trkpt"):
            continue
        lat = float(el.attrib["lat"])
        lon = float(el.attrib["lon"])
        ele = None
        for child in el:
            if child.tag.endswith("ele") and child.text:
                ele = float(child.text)
                break
        if ele is None:
            continue
        raw.append((lat, lon, ele))
    if len(raw) < 2:
        raise ValueError("GPX has too few track points with elevation")

    dist_m = [0.0]
    for i in range(1, len(raw)):
        dist_m.append(
            dist_m[-1]
            + _haversine_m(raw[i - 1][0], raw[i - 1][1], raw[i][0], raw[i][1])
        )
    raw_eles = [p[2] for p in raw]
    smooth_eles = _smooth(raw_eles, 7)
    gain, loss = _gain_loss(smooth_eles, 3.0)

    step = max(1, len(raw) // 600)
    profile = []
    for i in range(0, len(raw), step):
        profile.append(
            {
                "d_km": round(dist_m[i] / 1000.0, 3),
                "ele_m": round(smooth_eles[i], 1),
                "ele_ft": round(smooth_eles[i] * 3.28084, 0),
                "lat": round(raw[i][0], 6),
                "lon": round(raw[i][1], 6),
            }
        )
    if profile[-1]["d_km"] != round(dist_m[-1] / 1000.0, 3):
        profile.append(
            {
                "d_km": round(dist_m[-1] / 1000.0, 3),
                "ele_m": round(smooth_eles[-1], 1),
                "ele_ft": round(smooth_eles[-1] * 3.28084, 0),
                "lat": round(raw[-1][0], 6),
                "lon": round(raw[-1][1], 6),
            }
        )

    splits = []
    total_km = dist_m[-1] / 1000.0
    n_full = int(math.floor(total_km))
    idx = 0
    for km in range(1, n_full + 1):
        target = km * 1000.0
        while idx < len(dist_m) - 1 and dist_m[idx] < target:
            idx += 1
        start_target = (km - 1) * 1000.0
        j = 0
        while j < len(dist_m) - 1 and dist_m[j] < start_target:
            j += 1
        ele_start = smooth_eles[j]
        ele_end = smooth_eles[idx]
        delta = ele_end - ele_start
        splits.append(
            {
                "km": km,
                "ele_start_m": round(ele_start, 1),
                "ele_end_m": round(ele_end, 1),
                "delta_m": round(delta, 1),
                "grade_pct": round((delta / 1000.0) * 100.0, 2),
            }
        )
    if total_km - n_full > 0.05:
        j = 0
        start_target = n_full * 1000.0
        while j < len(dist_m) - 1 and dist_m[j] < start_target:
            j += 1
        delta = smooth_eles[-1] - smooth_eles[j]
        seg_m = dist_m[-1] - dist_m[j]
        splits.append(
            {
                "km": round(total_km, 2),
                "ele_start_m": round(smooth_eles[j], 1),
                "ele_end_m": round(smooth_eles[-1], 1),
                "delta_m": round(delta, 1),
                "grade_pct": round((delta / max(seg_m, 1.0)) * 100.0, 2),
                "partial": True,
            }
        )

    min_ele = min(smooth_eles)
    max_ele = max(smooth_eles)
    return {
        "name": "Ladakh Marathon - Full Marathon",
        "race_date": "2026-09-13",
        "location": "Leh, Ladakh (~11,500 ft)",
        "distance_m": round(dist_m[-1], 1),
        "distance_km": round(total_km, 3),
        "elev_gain_m": round(gain, 1),
        "elev_loss_m": round(loss, 1),
        "elev_min_m": round(min_ele, 1),
        "elev_max_m": round(max_ele, 1),
        "elev_min_ft": round(min_ele * 3.28084, 0),
        "elev_max_ft": round(max_ele * 3.28084, 0),
        "point_count": len(raw),
        "profile": profile,
        "splits": splits,
        "model": MODEL_NAME,
        "gpx_file": str(path.name),
        "source": {
            "geometry": (
                "Official Google My Map Marathon Route Map 2023, "
                "embedded on ladakhmarathon.projectsclique.com race page"
            ),
            "map_url": "https://www.google.com/maps/d/viewer?mid=1ORlfguX-RGVZa1JoPdjpy42ERWo",
            "elevation": "OpenTopoData Mapzen DEM lookup on densified course vertices",
            "official_distance_km": 42.195,
        },
    }


@lru_cache(maxsize=1)
def course() -> dict[str, Any]:
    return parse_gpx(_ensure_full_gpx())


def equivalent_flat_km(distance_km: float, gain_m: float, loss_m: float) -> float:
    adj = distance_km + (gain_m / CLIMB_EQ_M_PER_KM) - (loss_m / DESCENT_EQ_M_PER_KM)
    return max(distance_km * 0.85, adj)


def pace_sec_per_km_from_string(pace: str) -> int:
    pace = pace.strip()
    if ":" not in pace:
        raise ValueError("pace must be m:ss")
    parts = pace.split(":")
    if len(parts) != 2:
        raise ValueError("pace must be m:ss")
    minutes, seconds = int(parts[0]), int(parts[1])
    if seconds >= 60 or minutes < 0 or seconds < 0:
        raise ValueError("invalid pace")
    total = minutes * 60 + seconds
    if total < 150 or total > 1200:
        raise ValueError("pace out of sane range")
    return total


def format_hms(total_sec: float) -> str:
    total_sec = int(round(total_sec))
    h = total_sec // 3600
    m = (total_sec % 3600) // 60
    s = total_sec % 60
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def format_pace(sec_per_km: float) -> str:
    sec_per_km = max(1, int(round(sec_per_km)))
    return f"{sec_per_km // 60}:{sec_per_km % 60:02d}"


def parse_finish_time(t: str) -> int:
    t = t.strip()
    parts = [int(p) for p in t.split(":")]
    if len(parts) == 2:
        h, m, s = 0, parts[0], parts[1]
    elif len(parts) == 3:
        h, m, s = parts
    else:
        raise ValueError("time must be H:MM:SS or M:SS")
    if m >= 60 or s >= 60 or h < 0:
        raise ValueError("invalid time")
    total = h * 3600 + m * 60 + s
    if total < 5400 or total > 36000:
        raise ValueError("finish time out of sane range")
    return total


class PaceRequest(BaseModel):
    mode: Literal["pace", "finish"] = "pace"
    target_pace: str | None = Field(None, description="Flat-equivalent pace min/km as m:ss")
    target_finish: str | None = Field(None, description="Finish time H:MM:SS")
    pace_sec: int | None = Field(None, description="Optional pace as seconds/km")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/course")
def api_course() -> dict[str, Any]:
    try:
        return course()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/calculate")
def api_calculate(
    mode: Literal["pace", "finish"] = Query("pace"),
    target_pace: str | None = None,
    target_finish: str | None = None,
    pace_sec: int | None = None,
) -> dict[str, Any]:
    c = course()
    dist = c["distance_km"]
    gain = c["elev_gain_m"]
    loss = c["elev_loss_m"]
    eq = equivalent_flat_km(dist, gain, loss)

    if mode == "pace":
        if pace_sec is not None:
            flat_pace = pace_sec
        elif target_pace:
            try:
                flat_pace = pace_sec_per_km_from_string(target_pace)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        else:
            raise HTTPException(status_code=400, detail="provide target_pace or pace_sec")
        finish_sec = eq * flat_pace
        clock_pace = finish_sec / dist
        split_times = []
        cum = 0.0
        for sp in c["splits"]:
            seg_km = 1.0 if not sp.get("partial") else (dist - math.floor(dist))
            g = max(0.0, sp["delta_m"])
            l = max(0.0, -sp["delta_m"])
            seg_eq = equivalent_flat_km(seg_km, g, l)
            seg_sec = seg_eq * flat_pace
            cum += seg_sec
            split_times.append(
                {
                    **sp,
                    "seg_km": round(seg_km, 3),
                    "equiv_km": round(seg_eq, 3),
                    "split_pace": format_pace(seg_sec / seg_km),
                    "split_time": format_hms(seg_sec),
                    "cum_time": format_hms(cum),
                    "cum_sec": int(round(cum)),
                }
            )
        finish_sec = cum
        clock_pace = finish_sec / dist
        if split_times:
            split_times[-1]["cum_time"] = format_hms(finish_sec)
        return {
            "mode": "pace",
            "model": MODEL_NAME,
            "flat_pace": format_pace(flat_pace),
            "flat_pace_sec": flat_pace,
            "distance_km": dist,
            "equivalent_flat_km": round(eq, 3),
            "elev_gain_m": gain,
            "elev_loss_m": loss,
            "estimated_finish": format_hms(finish_sec),
            "estimated_finish_sec": int(round(finish_sec)),
            "avg_clock_pace": format_pace(clock_pace),
            "effort_note": (
                f"At {format_pace(flat_pace)}/km flat-equivalent effort, course plays like "
                f"{eq:.2f} km -> finish ~{format_hms(finish_sec)} "
                f"(clock avg {format_pace(clock_pace)}/km)."
            ),
            "splits": split_times,
        }

    if not target_finish:
        raise HTTPException(status_code=400, detail="provide target_finish")
    try:
        finish_sec = parse_finish_time(target_finish)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    flat_pace = finish_sec / eq
    clock_pace = finish_sec / dist
    split_times = []
    cum = 0.0
    for sp in c["splits"]:
        seg_km = 1.0 if not sp.get("partial") else (dist - math.floor(dist))
        g = max(0.0, sp["delta_m"])
        l = max(0.0, -sp["delta_m"])
        seg_eq = equivalent_flat_km(seg_km, g, l)
        seg_sec = seg_eq * flat_pace
        cum += seg_sec
        split_times.append(
            {
                **sp,
                "seg_km": round(seg_km, 3),
                "equiv_km": round(seg_eq, 3),
                "split_pace": format_pace(seg_sec / seg_km),
                "split_time": format_hms(seg_sec),
                "cum_time": format_hms(cum),
            }
        )
    if split_times:
        split_times[-1]["cum_time"] = format_hms(finish_sec)
        split_times[-1]["cum_sec"] = int(round(finish_sec))
    return {
        "mode": "finish",
        "model": MODEL_NAME,
        "target_finish": format_hms(finish_sec),
        "target_finish_sec": finish_sec,
        "distance_km": dist,
        "equivalent_flat_km": round(eq, 3),
        "elev_gain_m": gain,
        "elev_loss_m": loss,
        "required_flat_pace": format_pace(flat_pace),
        "required_flat_pace_sec": int(round(flat_pace)),
        "avg_clock_pace": format_pace(clock_pace),
        "effort_note": (
            f"To finish in {format_hms(finish_sec)} you need ~{format_pace(flat_pace)}/km "
            f"flat-equivalent effort (clock avg {format_pace(clock_pace)}/km on "
            f"{dist:.2f} km ~ {eq:.2f} km grade-adjusted)."
        ),
        "splits": split_times,
    }


@app.post("/api/calculate")
def api_calculate_post(body: PaceRequest) -> dict[str, Any]:
    return api_calculate(
        mode=body.mode,
        target_pace=body.target_pace,
        target_finish=body.target_finish,
        pace_sec=body.pace_sec,
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "10000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
