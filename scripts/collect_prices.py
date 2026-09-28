#!/usr/bin/env python3
"""Collect Iranian gold/USD snapshots from public sources and update static JSON.

No third-party Python packages are required. The script is designed for
GitHub Actions and degrades gracefully when one provider is unavailable.
"""
from __future__ import annotations

import argparse
import ast
import html
import json
import math
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from statistics import median
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
LATEST = DATA / "latest.json"
HISTORY = DATA / "history.json"
UA = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/124 Safari/537.36 KarenFuse/0.2"

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch(url: str, timeout: int = 15) -> str:
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/html,*/*", "Accept-Language": "fa,en;q=0.8"})
    with urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", errors="replace")


def parse_number(value) -> float | None:
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


def valid_gold(v) -> bool:
    return v is not None and 1_000_000 <= v <= 100_000_000


def valid_usd(v) -> bool:
    return v is not None and 10_000 <= v <= 1_000_000


def source_result(name: str, gold=None, usd=None, updated_at=None, error=None):
    return {
        "name": name,
        "ok": bool((valid_gold(gold) or valid_usd(usd)) and not error),
        "gold18_toman": round(gold) if valid_gold(gold) else None,
        "usd_toman": round(usd) if valid_usd(usd) else None,
        "updated_at": updated_at or now_iso(),
        "error": error,
    }


def collect_tgju():
    try:
        values = {}
        updated = None
        for key, slug in (("gold", "geram18"), ("usd", "price_dollar_rl")):
            raw = fetch(f"https://api.tgju.org/v1/market/indicator/profile/{slug}")
            data = json.loads(raw)
            resp = data.get("response") or {}
            summary = resp.get("summary") or {}
            price = (summary.get("price") or {}).get("plain")
            n = parse_number(price)
            if n:
                n /= 10
            values[key] = n
            updated = (resp.get("info") or {}).get("datetime") or updated
        return source_result("TGJU", values.get("gold"), values.get("usd"), updated_at=updated or now_iso())
    except Exception as e:
        return source_result("TGJU", error=f"{type(e).__name__}: {e}")


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


def collect_estjt():
    try:
        raw = fetch("https://www.estjt.ir/")
        text = strip_html(raw)
        gold = extract_near(text, ["طلا ۱۸ عیار", "طلای ۱۸ عیار", "طلا18عیار", "طلای18عیار"], valid_gold)
        if not valid_gold(gold):
            return source_result("اتحادیه طلا تهران", error="قیمت طلای ۱۸ عیار در صفحه پیدا نشد")
        return source_result("اتحادیه طلا تهران", gold=gold)
    except Exception as e:
        return source_result("اتحادیه طلا تهران", error=f"{type(e).__name__}: {e}")


def decode_navasan_payload(raw: str) -> str:
    # The free widget calls navasanret(...) with a JS string. That string is
    # itself JSON text, so some responses need two decoding passes.
    m = re.search(r"navasanret\\((.*)\\)\\s*;?\\s*$", raw, re.S)
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


def collect_zarscan():
    try:
        text = strip_html(fetch("https://zarscan.ir/"))
        gold = extract_near(text, ["طلای ۱۸ عیار", "طلای 18 عیار"], valid_gold)
        usd = extract_near(text, ["دلار"], valid_usd)
        if not valid_gold(gold) and not valid_usd(usd):
            return source_result("زر اسکن", error="قیمت قابل استفاده در صفحه عمومی پیدا نشد")
        return source_result("زر اسکن", gold=gold, usd=usd)
    except Exception as e:
        return source_result("زر اسکن", error=f"{type(e).__name__}: {e}")


def collect_geram18():
    try:
        text = strip_html(fetch("https://geram18.ir/"))
        gold = extract_near(text, ["طلای ۱۸ عیار", "طلای 18 عیار"], valid_gold)
        usd = extract_near(text, ["دلار"], valid_usd)
        if not valid_gold(gold) and not valid_usd(usd):
            return source_result("گرم ۱۸", error="قیمت قابل استفاده در صفحه عمومی پیدا نشد")
        return source_result("گرم ۱۸", gold=gold, usd=usd)
    except Exception as e:
        return source_result("گرم ۱۸", error=f"{type(e).__name__}: {e}")


def collect_navasan_widget():
    try:
        # First try the lightweight, officially documented free widget endpoint.
        raw = fetch("https://www.navasan.tech/wp-navasan.php?usd&18ayar")
        payload = decode_navasan_payload(raw)
        text = strip_html(payload)
        gold = extract_near(
            text,
            ["یک گرم طلا 18 عیار", "یک گرم طلا ۱۸ عیار", "طلای 18 عیار", "طلای ۱۸ عیار", "18 عیار", "۱۸ عیار"],
            valid_gold,
        )
        usd = extract_near(text, ["دلار آمریکا", "دلار", "USD"], valid_usd)

        # Some widget responses are heavily escaped. The public module/demo page
        # contains the same free table and is a robust fallback.
        if not valid_gold(gold) or not valid_usd(usd):
            demo = strip_html(fetch("https://www.navasan.tech/module.php"))
            if not valid_gold(gold):
                gold = extract_near(
                    demo,
                    ["یک گرم طلا 18 عیار", "یک گرم طلا ۱۸ عیار", "طلای 18 عیار", "طلای ۱۸ عیار"],
                    valid_gold,
                )
            if not valid_usd(usd):
                usd = extract_near(demo, ["دلار آمریکا"], valid_usd)

        if not valid_gold(gold) and not valid_usd(usd):
            return source_result("نوسان", error="قیمت قابل استفاده در ویجت/صفحه عمومی پیدا نشد")
        return source_result("نوسان", gold=gold, usd=usd)
    except Exception as e:
        return source_result("نوسان", error=f"{type(e).__name__}: {e}")


def spread_pct(values):
    vals = [float(v) for v in values if v is not None and float(v) > 0]
    if len(vals) < 2:
        return 0.0 if len(vals) == 1 else None
    med = median(vals)
    return round((max(vals) - min(vals)) / med * 100, 4) if med else None


def consensus(values):
    vals = [float(v) for v in values if v is not None and float(v) > 0]
    return round(median(vals)) if vals else None


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")


def collect():
    sources = {
        "tgju": collect_tgju(),
        "estjt": collect_estjt(),
        "zarscan": collect_zarscan(),
        "geram18": collect_geram18(),
        "navasan_widget": collect_navasan_widget(),
    }
    golds = [s.get("gold18_toman") for s in sources.values() if s.get("ok")]
    usds = [s.get("usd_toman") for s in sources.values() if s.get("ok")]
    generated = now_iso()
    latest = {
        "version": 1,
        "generated_at": generated,
        "sources": sources,
        "consensus": {"gold18_toman": consensus(golds), "usd_toman": consensus(usds)},
        "spread": {"gold_pct": spread_pct(golds), "usd_pct": spread_pct(usds)},
    }
    write_json(LATEST, latest)

    h = load_json(HISTORY, {"version": 1, "points": []})
    points = h.get("points") if isinstance(h, dict) else []
    if not isinstance(points, list):
        points = []
    point = {
        "ts": generated,
        "gold18_toman": latest["consensus"]["gold18_toman"],
        "usd_toman": latest["consensus"]["usd_toman"],
        "gold_spread_pct": latest["spread"]["gold_pct"],
        "usd_spread_pct": latest["spread"]["usd_pct"],
        "source_count": sum(1 for s in sources.values() if s.get("ok")),
    }
    if point["gold18_toman"] or point["usd_toman"]:
        points.append(point)
    cutoff = datetime.now(timezone.utc) - timedelta(days=31)
    cleaned = []
    for p in points[-3000:]:
        try:
            dt = datetime.fromisoformat(str(p.get("ts", "")).replace("Z", "+00:00"))
            if dt >= cutoff:
                cleaned.append(p)
        except Exception:
            continue
    write_json(HISTORY, {"version": 1, "points": cleaned})
    return latest


def self_test():
    assert parse_number("۲۴٬۴۲۴٬۱۰۰") == 24424100
    sample = "اتحادیه طلا تهران طلا ۱۸ عیار ۲۴٫۴۲۴٫۱۰۰ سکه"
    assert extract_near(sample, ["طلا ۱۸ عیار"], valid_gold) == 24424100
    assert consensus([10, 12, 100]) == 12
    assert abs(spread_pct([100, 101]) - 0.995) < 0.001
    widget = 'navasanret("<table><tr><td>دلار آمریکا</td><td>۲۳۵,۳۰۰</td></tr><tr><td>طلای 18 عیار</td><td>۲۴,۴۲۴,۱۰۰</td></tr></table>")'
    text = strip_html(decode_navasan_payload(widget))
    assert extract_near(text, ["دلار آمریکا"], valid_usd) == 235300
    assert extract_near(text, ["طلای 18 عیار"], valid_gold) == 24424100
    print("self-test: ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0
    latest = collect()
    print(json.dumps(latest, ensure_ascii=False, indent=2))
    if not latest["consensus"]["gold18_toman"] and not latest["consensus"]["usd_toman"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
