#!/usr/bin/env python3
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
data = root / "data"

latest = json.loads((data / "latest.json").read_text("utf-8"))
assert latest.get("version") == 2
assert latest.get("snapshot_ts")
assert isinstance(latest.get("sources"), dict) and latest["sources"]
assert set(("gold", "usd", "xau")) <= set((latest.get("source_counts") or {}).keys())
assert set(("gold18_toman", "usd_toman", "xau_usd")) <= set((latest.get("consensus") or {}).keys())

allowed = {"OK", "STALE", "ERROR", "MISSING"}
for key, source in latest["sources"].items():
    assert source.get("source_key") == key
    assert source.get("collected_at")
    assert "source_updated_at" in source
    for field in ("status", "gold18_status", "usd_status", "xau_status"):
        assert source.get(field) in allowed, f"{key}: invalid {field}"

history = json.loads((data / "history.json").read_text("utf-8"))
assert history.get("version") == 2
assert history.get("points")
last = history["points"][-1]
assert last.get("snapshot_ts")
assert isinstance(last.get("sources"), dict) and last["sources"]
assert isinstance(last.get("source_counts"), dict)

compact = json.loads((data / "consensus_history.json").read_text("utf-8"))
assert compact.get("points")
assert compact["points"][-1].get("ts")

tgju = json.loads((data / "tgju_history.json").read_text("utf-8"))
for key in ("gold", "usd", "xau"):
    rows = (tgju.get("series") or {}).get(key)
    assert isinstance(rows, list) and rows, f"TGJU history missing {key}"
    row = rows[-1]
    for field in ("date", "open", "low", "high", "close"):
        assert row.get(field) is not None, f"{key}: missing {field}"

xau_sources = [s for s in latest["sources"].values() if s.get("xau_status") == "OK"]
assert xau_sources, "no live XAU source in generated latest.json"

print("data-contract-test: ok")
print("snapshot:", latest["snapshot_ts"])
print("counts:", latest["source_counts"])
print("consensus:", latest["consensus"])
print("xau_sources:", [(s["source_key"], s["xau_usd"]) for s in xau_sources])
print("history_points:", len(history["points"]))
print("compact_points:", len(compact["points"]))
print("tgju_daily_rows:", {k: len(tgju["series"][k]) for k in ("gold","usd","xau")})
