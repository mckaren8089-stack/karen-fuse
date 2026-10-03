#!/usr/bin/env python3
"""Collect Karen Fuse market snapshots and maintain bounded market history.

The collector intentionally has no third-party Python dependencies so it can
run on GitHub Actions. Public providers may fail independently; one failed
provider must never poison the full snapshot.
"""
from __future__ import annotations

import argparse
import ast
import html
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from statistics import median
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
LATEST = DATA / "latest.json"
HISTORY = DATA / "history.json"
CONSENSUS_HISTORY = DATA / "consensus_history.json"
TGJU_HISTORY = DATA / "tgju_history.json"

UA = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/124 Safari/537.36 KarenFuse/0.4"
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
ASSETS = ("gold18", "usd", "xau")
STATUS_OK = "OK"
STATUS_STALE = "STALE"
STATUS_ERROR = "ERROR"
STATUS_MISSING = "MISSING"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch(url: str, timeout: int = 15, headers: dict | None = None) -> str:
    base_headers = {
        "User-Agent": UA,
        "Accept": "application/json,text/html,*/*",
        "Accept-Language": "fa,en;q=0.8",
    }
    if headers:
        base_headers.update(headers)
    req = Request(url, headers=base_headers)
    with urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", errors="replace")


def parse_number(value) -> float | None:
    """Parse domestic integer-like prices; punctuation is treated as grouping."""
    if value is None:
        return None
    s = html.unescape(str(value)).translate(PERSIAN_DIGITS)
    s = re.sub(r"[^0-9.,+\-٬٫]", "", s)
    s = re.sub(r"[,.٬٫]", "", s)
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def parse_decimal(value) -> float | None:
    """Parse values where decimal precision matters, such as XAU/USD."""
    if value is None:
        return None
    s = html.unescape(str(value)).translate(PERSIAN_DIGITS).replace("٬", "").replace(",", "").replace("٫", ".")
    s = re.sub(r"[^0-9.+\-]", "", s)
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def valid_gold(v) -> bool:
    return v is not None and 1_000_000 <= float(v) <= 100_000_000


def valid_usd(v) -> bool:
    return v is not None and 10_000 <= float(v) <= 1_000_000


def valid_xau(v) -> bool:
    return v is not None and 500 <= float(v) <= 10_000


def tgju_timestamp_fresh(value: str | None, max_age_minutes: int = 30) -> bool:
    if not value:
        return True
    try:
        dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZoneInfo("Asia/Tehran"))
        age = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
        return -5 <= age <= max_age_minutes
    except Exception:
        return True


def iso_timestamp_fresh(value: str | None, max_age_minutes: int = 15) -> bool:
    if not value:
        return True
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
        return -5 <= age <= max_age_minutes
    except Exception:
        return True


def source_result(
    source_key: str,
    name: str,
    expected_assets: tuple[str, ...] | list[str],
    *,
    gold=None,
    usd=None,
    usd_buy=None,
    usd_sell=None,
    xau=None,
    asset_updated_at: dict | None = None,
    stale_assets: set[str] | None = None,
    asset_errors: dict | None = None,
    collected_at: str | None = None,
):
    collected_at = collected_at or now_iso()
    expected = set(expected_assets)
    stale_assets = set(stale_assets or ())
    asset_errors = dict(asset_errors or {})
    asset_updated_at = dict(asset_updated_at or {})

    gold_ok = valid_gold(gold)
    usd_ok = valid_usd(usd) or valid_usd(usd_buy) or valid_usd(usd_sell)
    xau_ok = valid_xau(xau)

    def status(asset: str, valid: bool) -> str:
        if asset not in expected:
            return STATUS_MISSING
        if asset in stale_assets:
            return STATUS_STALE
        if asset in asset_errors:
            return STATUS_ERROR
        return STATUS_OK if valid else STATUS_MISSING

    gold_status = status("gold18", gold_ok)
    usd_status = status("usd", usd_ok)
    xau_status = status("xau", xau_ok)
    statuses = [gold_status, usd_status, xau_status]

    if STATUS_OK in statuses:
        overall = STATUS_OK
    elif STATUS_STALE in statuses:
        overall = STATUS_STALE
    elif STATUS_ERROR in statuses:
        overall = STATUS_ERROR
    else:
        overall = STATUS_MISSING

    errors = [f"{k}: {v}" for k, v in asset_errors.items() if v]
    updated_values = [asset_updated_at.get(a) for a in ASSETS if asset_updated_at.get(a)]

    return {
        "source_key": source_key,
        "name": name,
        "collected_at": collected_at,
        "updated_at": collected_at,  # compatibility with v0.3 clients
        "source_updated_at": max(updated_values) if updated_values else None,
        "status": overall,
        "ok": STATUS_OK in statuses,
        "error": "; ".join(errors) if errors else None,
        "gold18_toman": round(float(gold)) if gold_ok else None,
        "gold18_status": gold_status,
        "gold18_source_updated_at": asset_updated_at.get("gold18"),
        "gold18_error": asset_errors.get("gold18"),
        "usd_toman": round(float(usd)) if valid_usd(usd) else None,
        "usd_buy_toman": round(float(usd_buy)) if valid_usd(usd_buy) else None,
        "usd_sell_toman": round(float(usd_sell)) if valid_usd(usd_sell) else None,
        "usd_status": usd_status,
        "usd_source_updated_at": asset_updated_at.get("usd"),
        "usd_error": asset_errors.get("usd"),
        "xau_usd": round(float(xau), 2) if xau_ok else None,
        "xau_status": xau_status,
        "xau_source_updated_at": asset_updated_at.get("xau"),
        "xau_error": asset_errors.get("xau"),
    }


def collect_tgju():
    values = {}
    updated = {}
    stale = set()
    errors = {}
    for asset, slug in (("gold18", "geram18"), ("usd", "price_dollar_rl")):
        try:
            raw = fetch(f"https://api.tgju.org/v1/market/indicator/profile/{slug}")
            data = json.loads(raw)
            resp = data.get("response") or {}
            price = ((resp.get("summary") or {}).get("price") or {}).get("plain")
            n = parse_number(price)
            if n:
                n /= 10
            values[asset] = n
            ts = (resp.get("info") or {}).get("datetime")
            updated[asset] = ts
            if ts and not tgju_timestamp_fresh(ts):
                stale.add(asset)
        except Exception as e:
            errors[asset] = f"{type(e).__name__}: {e}"
    return source_result(
        "tgju",
        "TGJU",
        ("gold18", "usd"),
        gold=values.get("gold18"),
        usd=values.get("usd"),
        asset_updated_at=updated,
        stale_assets=stale,
        asset_errors=errors,
    )


def collect_tgju_xau():
    try:
        raw = fetch("https://api.tgju.org/v1/market/indicator/profile/ons")
        data = json.loads(raw)
        resp = data.get("response") or {}
        price = ((resp.get("summary") or {}).get("price") or {}).get("plain")
        xau = parse_decimal(price)
        ts = (resp.get("info") or {}).get("datetime")
        stale = {"xau"} if ts and not tgju_timestamp_fresh(ts) else set()
        return source_result(
            "tgju_xau",
            "TGJU اونس",
            ("xau",),
            xau=xau,
            asset_updated_at={"xau": ts},
            stale_assets=stale,
        )
    except Exception as e:
        return source_result(
            "tgju_xau",
            "TGJU اونس",
            ("xau",),
            asset_errors={"xau": f"{type(e).__name__}: {e}"},
        )


def collect_gold_api():
    try:
        data = json.loads(fetch("https://api.gold-api.com/price/XAU"))
        xau = parse_decimal(data.get("price"))
        ts = data.get("updatedAt")
        stale = {"xau"} if ts and not iso_timestamp_fresh(ts) else set()
        return source_result(
            "gold_api",
            "Gold API",
            ("xau",),
            xau=xau,
            asset_updated_at={"xau": ts},
            stale_assets=stale,
        )
    except Exception as e:
        return source_result(
            "gold_api",
            "Gold API",
            ("xau",),
            asset_errors={"xau": f"{type(e).__name__}: {e}"},
        )


def strip_html(raw: str) -> str:
    raw = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw)
    raw = re.sub(r"(?is)<style.*?>.*?</style>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    raw = html.unescape(raw).replace("\u200c", " ").replace("\u200f", " ").replace("\u200e", " ")
    return re.sub(r"\s+", " ", raw).strip()


def extract_near(text: str, labels: list[str], validator, max_after: int = 220):
    norm = text.translate(PERSIAN_DIGITS)
    for label in labels:
        label_norm = label.translate(PERSIAN_DIGITS)
        idx = norm.find(label_norm)
        if idx < 0:
            continue
        window = norm[idx + len(label_norm): idx + len(label_norm) + max_after]
        for token in re.findall(r"[0-9۰-۹][0-9۰-۹,٬.٫]{3,}", window):
            n = parse_number(token)
            if validator(n):
                return n
    return None


def extract_values_after(text: str, label: str, validator, limit: int = 3, max_after: int = 180):
    norm = text.translate(PERSIAN_DIGITS)
    label_norm = label.translate(PERSIAN_DIGITS)
    idx = norm.find(label_norm)
    if idx < 0:
        return []
    window = norm[idx + len(label_norm): idx + len(label_norm) + max_after]
    out = []
    for token in re.findall(r"[0-9۰-۹][0-9۰-۹,٬.٫]{2,}", window):
        n = parse_number(token)
        if validator(n):
            out.append(n)
            if len(out) >= limit:
                break
    return out


def collect_estjt():
    try:
        text = strip_html(fetch("https://www.estjt.ir/"))
        gold = extract_near(text, ["طلا ۱۸ عیار", "طلای ۱۸ عیار", "طلا18عیار", "طلای18عیار"], valid_gold)
        return source_result("estjt", "اتحادیه طلا تهران", ("gold18",), gold=gold)
    except Exception as e:
        return source_result("estjt", "اتحادیه طلا تهران", ("gold18",), asset_errors={"gold18": f"{type(e).__name__}: {e}"})


def decode_navasan_payload(raw: str) -> str:
    m = re.search(r"navasanret\((.*)\)\s*;?\s*$", raw, re.S)
    if not m:
        return raw
    arg = m.group(1).strip()
    candidates = []
    try:
        candidates.append(json.loads(arg))
    except Exception:
        pass
    try:
        candidates.append(ast.literal_eval(arg))
    except Exception:
        pass
    for decoded in candidates:
        if not isinstance(decoded, str):
            continue
        try:
            nested = json.loads(decoded)
            if isinstance(nested, str):
                return nested
        except Exception:
            return decoded
    return raw


def collect_alanchand():
    try:
        text = strip_html(fetch("https://alanchand.com/"))
        usd_values = extract_values_after(text, "دلار آمریکا", valid_usd, limit=2, max_after=120)
        gold_values = extract_values_after(text, "گرم طلای 18 عیار", valid_gold, limit=1, max_after=160)
        if not gold_values:
            gold_values = extract_values_after(text, "گرم طلای ۱۸ عیار", valid_gold, limit=1, max_after=160)

        usd_buy = usd_values[0] if len(usd_values) > 0 else None
        usd_sell = usd_values[1] if len(usd_values) > 1 else None
        if valid_usd(usd_buy) and valid_usd(usd_sell):
            usd_mid = (usd_buy + usd_sell) / 2
        else:
            usd_mid = usd_sell if valid_usd(usd_sell) else usd_buy
        gold = gold_values[0] if gold_values else None
        return source_result(
            "alanchand",
            "الان چند",
            ("gold18", "usd"),
            gold=gold,
            usd=usd_mid,
            usd_buy=usd_buy,
            usd_sell=usd_sell,
        )
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        return source_result("alanchand", "الان چند", ("gold18", "usd"), asset_errors={"gold18": msg, "usd": msg})


def collect_pashizi():
    try:
        gold_text = strip_html(fetch("https://www.pashizi.com/fa/currency/gold_18k_gram"))
        usd_text = strip_html(fetch("https://www.pashizi.com/fa/currency/usd"))
        gold = extract_near(gold_text, ["طلا 18 عیار(گرم)", "طلا ۱۸ عیار", "طلای ۱۸ عیار"], valid_gold)
        usd = extract_near(usd_text, ["دلار آمریکا"], valid_usd)
        return source_result("pashizi", "پشیزی", ("gold18", "usd"), gold=gold, usd=usd)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        return source_result("pashizi", "پشیزی", ("gold18", "usd"), asset_errors={"gold18": msg, "usd": msg})


def collect_zarscan():
    try:
        text = strip_html(fetch("https://zarscan.ir/"))
        gold = extract_near(text, ["طلای ۱۸ عیار", "طلای 18 عیار"], valid_gold)
        usd = extract_near(text, ["دلار"], valid_usd)
        return source_result("zarscan", "زر اسکن", ("gold18", "usd"), gold=gold, usd=usd)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        return source_result("zarscan", "زر اسکن", ("gold18", "usd"), asset_errors={"gold18": msg, "usd": msg})


def collect_geram18():
    try:
        text = strip_html(fetch("https://geram18.ir/"))
        gold = extract_near(text, ["طلای ۱۸ عیار", "طلای 18 عیار"], valid_gold)
        usd = extract_near(text, ["دلار"], valid_usd)
        return source_result("geram18", "گرم ۱۸", ("gold18", "usd"), gold=gold, usd=usd)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        return source_result("geram18", "گرم ۱۸", ("gold18", "usd"), asset_errors={"gold18": msg, "usd": msg})


def collect_navasan_widget():
    try:
        raw = fetch("https://www.navasan.tech/wp-navasan.php?usd&18ayar")
        payload = decode_navasan_payload(raw)
        text = strip_html(payload)
        gold = extract_near(
            text,
            ["یک گرم طلا 18 عیار", "یک گرم طلا ۱۸ عیار", "طلای 18 عیار", "طلای ۱۸ عیار", "18 عیار", "۱۸ عیار"],
            valid_gold,
        )
        usd = extract_near(text, ["دلار آمریکا", "دلار", "USD"], valid_usd)
        if not valid_gold(gold) or not valid_usd(usd):
            demo = strip_html(fetch("https://www.navasan.tech/module.php"))
            if not valid_gold(gold):
                gold = extract_near(demo, ["یک گرم طلا 18 عیار", "یک گرم طلا ۱۸ عیار", "طلای 18 عیار", "طلای ۱۸ عیار"], valid_gold)
            if not valid_usd(usd):
                usd = extract_near(demo, ["دلار آمریکا"], valid_usd)
        return source_result("navasan_widget", "نوسان", ("gold18", "usd"), gold=gold, usd=usd)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        return source_result("navasan_widget", "نوسان", ("gold18", "usd"), asset_errors={"gold18": msg, "usd": msg})


def spread_pct(values):
    vals = [float(v) for v in values if v is not None and float(v) > 0]
    if len(vals) < 2:
        return None
    med = median(vals)
    return round((max(vals) - min(vals)) / med * 100, 4) if med else None


def consensus(values, decimals: int = 0, max_deviation_pct: float = 3.0):
    vals = [float(v) for v in values if v is not None and float(v) > 0]
    if not vals:
        return None
    center = median(vals)
    if len(vals) >= 3 and center:
        inliers = [v for v in vals if abs(v - center) / center * 100 <= max_deviation_pct]
        if inliers:
            center = median(inliers)
    return round(center, decimals)


def confidence(values):
    vals = [float(v) for v in values if v is not None and float(v) > 0]
    spread = spread_pct(vals)
    if not vals:
        level = "unavailable"
    elif len(vals) == 1:
        level = "single_source"
    elif len(vals) >= 3 and spread is not None and spread <= 1.5:
        level = "high"
    elif spread is not None and spread <= 3.0:
        level = "medium"
    else:
        level = "low"
    return {"level": level, "source_count": len(vals), "spread_pct": spread}


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")


def source_history_view(source: dict):
    keys = [
        "source_key", "name", "collected_at", "source_updated_at", "status", "error",
        "gold18_toman", "gold18_status", "gold18_source_updated_at", "gold18_error",
        "usd_toman", "usd_buy_toman", "usd_sell_toman", "usd_status", "usd_source_updated_at", "usd_error",
        "xau_usd", "xau_status", "xau_source_updated_at", "xau_error",
    ]
    return {k: source.get(k) for k in keys}


def legacy_compact_point(point: dict):
    ts = point.get("snapshot_ts") or point.get("ts")
    if not ts:
        return None
    if isinstance(point.get("consensus"), dict):
        gold = point["consensus"].get("gold18_toman")
        usd = point["consensus"].get("usd_toman")
        xau = point["consensus"].get("xau_usd")
        counts = point.get("source_counts") or {}
        spread = point.get("spread") or {}
        quality = point.get("quality") or {}
    else:
        gold = point.get("gold18_toman")
        usd = point.get("usd_toman")
        xau = point.get("xau_usd")
        counts = {
            "gold": point.get("gold_source_count"),
            "usd": point.get("usd_source_count"),
            "xau": point.get("xau_source_count"),
        }
        spread = {
            "gold_pct": point.get("gold_spread_pct"),
            "usd_pct": point.get("usd_spread_pct"),
            "xau_pct": point.get("xau_spread_pct"),
        }
        quality = {}
    return {
        "ts": ts,
        "gold18_toman": gold,
        "usd_toman": usd,
        "xau_usd": xau,
        "source_counts": counts,
        "spread": spread,
        "quality": quality,
    }


def parse_ts(value: str | None):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def update_compact_history(raw_history_points: list, latest: dict):
    existing = load_json(CONSENSUS_HISTORY, {"version": 1, "points": []})
    points = existing.get("points") if isinstance(existing, dict) else []
    if not isinstance(points, list):
        points = []

    if not points:
        seeded = []
        for p in raw_history_points:
            cp = legacy_compact_point(p)
            if cp:
                seeded.append(cp)
        points = seeded

    last_dt = parse_ts(points[-1].get("ts")) if points else None
    now_dt = parse_ts(latest["snapshot_ts"])
    if not last_dt or not now_dt or (now_dt - last_dt).total_seconds() >= 30 * 60:
        points.append({
            "ts": latest["snapshot_ts"],
            "gold18_toman": latest["consensus"]["gold18_toman"],
            "usd_toman": latest["consensus"]["usd_toman"],
            "xau_usd": latest["consensus"]["xau_usd"],
            "source_counts": latest["source_counts"],
            "spread": latest["spread"],
            "quality": latest["quality"],
        })

    cutoff = datetime.now(timezone.utc) - timedelta(days=400)
    cleaned = []
    for p in points[-25000:]:
        dt = parse_ts(p.get("ts"))
        if dt and dt >= cutoff:
            cleaned.append(p)
    write_json(CONSENSUS_HISTORY, {"version": 1, "sample_interval_minutes": 30, "points": cleaned})


def tgju_table_url(slug: str, length: int):
    params = [("lang", "fa"), ("draw", "2")]
    for i in range(8):
        params.extend([
            (f"columns[{i}][data]", str(i)),
            (f"columns[{i}][name]", ""),
            (f"columns[{i}][searchable]", "true"),
            (f"columns[{i}][orderable]", "true"),
            (f"columns[{i}][search][value]", ""),
            (f"columns[{i}][search][regex]", "false"),
        ])
    params.extend([
        ("start", "0"),
        ("length", str(length)),
        ("search", ""),
        ("order_col", ""),
        ("order_dir", ""),
        ("from", ""),
        ("to", ""),
        ("convert_to_ad", "1"),
    ])
    return f"https://api.tgju.org/v1/market/indicator/summary-table-data/{slug}?{urlencode(params)}"


def clean_change_cell(value):
    return strip_html(str(value or "")).replace("%", "").replace(",", "").strip()


def fetch_tgju_daily(slug: str, asset: str, length: int = 500):
    raw = fetch(
        tgju_table_url(slug, length),
        timeout=25,
        headers={
            "Origin": "https://www.tgju.org",
            "Referer": "https://www.tgju.org/",
            "Accept": "application/json, text/javascript, */*; q=0.01",
        },
    )
    data = json.loads(raw)
    rows = data.get("data") or []
    out = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 7:
            continue
        parser = parse_decimal if asset == "xau" else parse_number
        values = [parser(row[i]) for i in range(4)]
        if any(v is None for v in values):
            continue
        if asset != "xau":
            values = [v / 10 for v in values]
        date = str(row[6]).replace("/", "-")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            continue
        change = parse_decimal(clean_change_cell(row[4]))
        if asset != "xau" and change is not None:
            change /= 10
        out.append({
            "date": date,
            "open": round(values[0], 2 if asset == "xau" else 0),
            "low": round(values[1], 2 if asset == "xau" else 0),
            "high": round(values[2], 2 if asset == "xau" else 0),
            "close": round(values[3], 2 if asset == "xau" else 0),
            "change": round(change, 2 if asset == "xau" else 0) if change is not None else None,
            "change_pct": parse_decimal(clean_change_cell(row[5])),
        })
    out.sort(key=lambda r: r["date"])
    return out


def maybe_refresh_tgju_history(force: bool = False):
    current = load_json(TGJU_HISTORY, {"version": 1, "series": {}, "errors": {}})
    fetched_at = parse_ts(current.get("fetched_at") if isinstance(current, dict) else None)
    if not force and fetched_at and (datetime.now(timezone.utc) - fetched_at).total_seconds() < 6 * 3600:
        return current

    specs = {
        "gold": ("geram18", "gold"),
        "usd": ("price_dollar_rl", "usd"),
        "xau": ("ons", "xau"),
    }
    series = dict((current.get("series") or {}) if isinstance(current, dict) else {})
    errors = {}
    for key, (slug, asset) in specs.items():
        try:
            rows = fetch_tgju_daily(slug, asset)
            if not rows:
                raise ValueError("empty history")
            series[key] = rows
        except Exception as e:
            errors[key] = f"{type(e).__name__}: {e}"

    payload = {
        "version": 1,
        "provider": "TGJU",
        "fetched_at": now_iso(),
        "series": series,
        "errors": errors,
    }
    write_json(TGJU_HISTORY, payload)
    return payload


def collect():
    collectors = {
        "alanchand": collect_alanchand,
        "tgju": collect_tgju,
        "estjt": collect_estjt,
        "pashizi": collect_pashizi,
        "zarscan": collect_zarscan,
        "geram18": collect_geram18,
        "navasan_widget": collect_navasan_widget,
        "gold_api": collect_gold_api,
        "tgju_xau": collect_tgju_xau,
    }
    unordered = {}
    with ThreadPoolExecutor(max_workers=len(collectors)) as pool:
        futures = {pool.submit(fn): key for key, fn in collectors.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                unordered[key] = future.result()
            except Exception as e:
                unordered[key] = source_result(
                    key,
                    key,
                    ASSETS,
                    asset_errors={a: f"{type(e).__name__}: {e}" for a in ASSETS},
                )
    sources = {key: unordered[key] for key in collectors}

    golds = [s.get("gold18_toman") for s in sources.values() if s.get("gold18_status") == STATUS_OK and valid_gold(s.get("gold18_toman"))]
    usds = [s.get("usd_toman") for s in sources.values() if s.get("usd_status") == STATUS_OK and valid_usd(s.get("usd_toman"))]
    xaus = [s.get("xau_usd") for s in sources.values() if s.get("xau_status") == STATUS_OK and valid_xau(s.get("xau_usd"))]

    generated = now_iso()
    counts = {"gold": len(golds), "usd": len(usds), "xau": len(xaus)}
    latest = {
        "version": 2,
        "snapshot_ts": generated,
        "generated_at": generated,
        "sources": sources,
        "consensus": {
            "gold18_toman": consensus(golds),
            "usd_toman": consensus(usds),
            "xau_usd": consensus(xaus, decimals=2),
        },
        "source_counts": counts,
        "gold_source_count": counts["gold"],
        "usd_source_count": counts["usd"],
        "xau_source_count": counts["xau"],
        "spread": {
            "gold_pct": spread_pct(golds),
            "usd_pct": spread_pct(usds),
            "xau_pct": spread_pct(xaus),
        },
        "quality": {
            "gold": confidence(golds),
            "usd": confidence(usds),
            "xau": confidence(xaus),
        },
    }
    write_json(LATEST, latest)

    previous = load_json(HISTORY, {"version": 1, "points": []})
    raw_points = previous.get("points") if isinstance(previous, dict) else []
    if not isinstance(raw_points, list):
        raw_points = []

    update_compact_history(raw_points, latest)

    rich_points = []
    for old in raw_points:
        ts = old.get("snapshot_ts") or old.get("ts")
        dt = parse_ts(ts)
        if not dt:
            continue
        if isinstance(old.get("sources"), dict):
            rich_points.append(old)
        elif dt >= datetime.now(timezone.utc) - timedelta(hours=72):
            rich_points.append({
                "snapshot_ts": ts,
                "ts": ts,
                "consensus": {
                    "gold18_toman": old.get("gold18_toman"),
                    "usd_toman": old.get("usd_toman"),
                    "xau_usd": old.get("xau_usd"),
                },
                "source_counts": {
                    "gold": old.get("gold_source_count"),
                    "usd": old.get("usd_source_count"),
                    "xau": old.get("xau_source_count"),
                },
                "legacy_source_count": old.get("source_count"),
                "spread": {
                    "gold_pct": old.get("gold_spread_pct"),
                    "usd_pct": old.get("usd_spread_pct"),
                    "xau_pct": old.get("xau_spread_pct"),
                },
                "quality": {},
                "sources": {},
                "legacy": True,
            })

    point = {
        "snapshot_ts": generated,
        "ts": generated,
        "consensus": latest["consensus"],
        "gold18_toman": latest["consensus"]["gold18_toman"],
        "usd_toman": latest["consensus"]["usd_toman"],
        "xau_usd": latest["consensus"]["xau_usd"],
        "source_counts": latest["source_counts"],
        "gold_source_count": counts["gold"],
        "usd_source_count": counts["usd"],
        "xau_source_count": counts["xau"],
        "spread": latest["spread"],
        "gold_spread_pct": latest["spread"]["gold_pct"],
        "usd_spread_pct": latest["spread"]["usd_pct"],
        "xau_spread_pct": latest["spread"]["xau_pct"],
        "quality": latest["quality"],
        "sources": {key: source_history_view(s) for key, s in sources.items()},
    }
    rich_points.append(point)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=72)
    cleaned = []
    for p in rich_points[-1000:]:
        dt = parse_ts(p.get("snapshot_ts") or p.get("ts"))
        if dt and dt >= cutoff:
            cleaned.append(p)
    write_json(HISTORY, {"version": 2, "retention_hours": 72, "points": cleaned})

    maybe_refresh_tgju_history()
    return latest


def self_test():
    assert parse_number("۲۴٬۴۲۴٬۱۰۰") == 24424100
    assert abs(parse_decimal("4,330.66") - 4330.66) < 0.001
    sample = "اتحادیه طلا تهران طلا ۱۸ عیار ۲۴٫۴۲۴٫۱۰۰ سکه"
    assert extract_near(sample, ["طلا ۱۸ عیار"], valid_gold) == 24424100
    assert consensus([10, 12, 100]) == 12
    assert consensus([100, 101, 150]) == 100
    assert spread_pct([100]) is None
    assert confidence([100])["level"] == "single_source"
    sample_alanchand = "دلار آمریکا ۲۴۳,۰۵۰ ۲۴۵,۵۰۰ - گرم طلای 18 عیار ۲۴,۵۰۴,۸۲۰ تومان"
    assert extract_values_after(sample_alanchand, "دلار آمریکا", valid_usd, limit=2) == [243050, 245500]
    assert extract_values_after(sample_alanchand, "گرم طلای 18 عیار", valid_gold, limit=1) == [24504820]
    widget = 'navasanret("<table><tr><td>دلار آمریکا</td><td>۲۳۵,۳۰۰</td></tr><tr><td>طلای 18 عیار</td><td>۲۴,۴۲۴,۱۰۰</td></tr></table>")'
    text = strip_html(decode_navasan_payload(widget))
    assert extract_near(text, ["دلار آمریکا"], valid_usd) == 235300
    assert extract_near(text, ["طلای 18 عیار"], valid_gold) == 24424100
    s = source_result("test", "Test", ("gold18",), gold=24_000_000)
    assert s["gold18_status"] == STATUS_OK and s["usd_status"] == STATUS_MISSING
    print("self-test: ok")


def probe():
    gold_api = collect_gold_api()
    tgju_xau = collect_tgju_xau()
    history = {}
    specs = {
        "gold": ("geram18", "gold"),
        "usd": ("price_dollar_rl", "usd"),
        "xau": ("ons", "xau"),
    }
    for key, (slug, asset) in specs.items():
        try:
            rows = fetch_tgju_daily(slug, asset, length=10)
            history[key] = {
                "rows": len(rows),
                "error": None,
                "last": rows[-1] if rows else None,
            }
        except Exception as e:
            history[key] = {
                "rows": 0,
                "error": f"{type(e).__name__}: {e}",
                "last": None,
            }
    report = {
        "gold_api": gold_api,
        "tgju_xau": tgju_xau,
        "tgju_history": history,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    history_ok = all(history[k]["rows"] > 0 for k in specs)
    xau_ok = gold_api.get("xau_status") == STATUS_OK and tgju_xau.get("xau_status") == STATUS_OK
    return 0 if history_ok and xau_ok else 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--probe", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0
    if args.probe:
        return probe()
    latest = collect()
    print(json.dumps(latest, ensure_ascii=False, indent=2))
    if not any(latest["consensus"].values()):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
