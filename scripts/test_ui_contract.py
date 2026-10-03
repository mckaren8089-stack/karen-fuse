#!/usr/bin/env python3
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app = (root / "app.js").read_text("utf-8")
html = (root / "index.html").read_text("utf-8")
css = (root / "style.css").read_text("utf-8")

m = re.search(r"const\s+ids\s*=\s*\[(.*?)\];", app, re.S)
assert m, "app.js ids registry not found"
required = set(re.findall(r"['\"]([^'\"]+)['\"]", m.group(1)))
present = set(re.findall(r'\bid=["\']([^"\']+)["\']', html))
missing = sorted(required - present)
assert not missing, "index.html missing ids used by app.js: " + ", ".join(missing)

calc_pos = html.find('<script src="calc.js"></script>')
app_pos = html.find('<script src="app.js"></script>')
assert calc_pos >= 0 and app_pos >= 0 and calc_pos < app_pos, "calc.js must load before app.js"

for value in ("1", "6", "24", "72", "168", "720", "2160", "8760"):
    assert f'data-hours="{value}"' in html, f"missing chart range {value}"

print("ui-contract-test: ok")

assert ".chart-empty[hidden]" in css, "hidden chart overlay must have an explicit CSS override"
assert "asset-source-group" in app, "source rendering must be grouped by asset"

assert "setLineDash([6,6])" in app, "intraday collection gaps must render as dashed bridges"
assert "Mark every real observation" in app, "sparse chart windows must show real observation markers"
