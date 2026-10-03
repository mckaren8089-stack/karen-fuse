# Karen Fuse Data Schema v2

## Time semantics

- `snapshot_ts`: زمان ساخت Snapshot کامل Karen Fuse در UTC/ISO-8601.
- `collected_at`: زمان دریافت Observation توسط Collector.
- `source_updated_at`: زمان اعلام‌شده توسط Provider؛ اگر Provider ارائه نکند `null`.
- فیلد `generated_at` در `latest.json` فعلاً فقط برای سازگاری با Client قدیمی نگه داشته می‌شود.

## Source status

هر Source وضعیت کلی و وضعیت Asset-level دارد:

- `OK`: Quote معتبر و تازه است.
- `STALE`: Quote دریافت شده ولی Timestamp منبع از حد تازگی عبور کرده است.
- `ERROR`: دریافت/Parsing مورد انتظار شکست خورده است.
- `MISSING`: آن Source این Asset را ارائه نمی‌کند یا Quote قابل استفاده در Observation ندارد.

ورود به Consensus فقط با وضعیت Asset-level برابر `OK` انجام می‌شود.

## latest.json

ساختار اصلی:

```json
{
  "version": 2,
  "snapshot_ts": "ISO-8601 UTC",
  "generated_at": "compatibility alias",
  "sources": {
    "source_key": {
      "source_key": "source_key",
      "name": "display name",
      "collected_at": "ISO-8601 UTC",
      "source_updated_at": null,
      "status": "OK|STALE|ERROR|MISSING",
      "error": null,
      "gold18_toman": null,
      "gold18_status": "MISSING",
      "usd_toman": null,
      "usd_buy_toman": null,
      "usd_sell_toman": null,
      "usd_status": "MISSING",
      "xau_usd": null,
      "xau_status": "MISSING"
    }
  },
  "consensus": {
    "gold18_toman": null,
    "usd_toman": null,
    "xau_usd": null
  },
  "source_counts": {"gold": 0, "usd": 0, "xau": 0},
  "spread": {"gold_pct": null, "usd_pct": null, "xau_pct": null},
  "quality": {
    "gold": {"level": "unavailable", "source_count": 0, "spread_pct": null},
    "usd": {"level": "unavailable", "source_count": 0, "spread_pct": null},
    "xau": {"level": "unavailable", "source_count": 0, "spread_pct": null}
  }
}
```

برای یک Source تنها، Spread برابر `null` است؛ صفر به معنی توافق چند منبع نیست.

## history.json

Rolling Source-level history با Retention فعلی ۷۲ ساعت. هر Point شامل:

- `snapshot_ts`
- `consensus`
- `source_counts`
- `spread`
- `quality`
- `sources` با Observation کامل همان Snapshot

Snapshotهای قدیمی Schema v1 که هنوز داخل پنجره ۷۲ ساعته‌اند با `legacy: true` قابل نگهداری‌اند؛ Source-level گذشته‌ای که قبلاً ثبت نشده بازسازی نمی‌شود.

## consensus_history.json

آرشیو فشردهٔ اجماع Karen Fuse با هدف یک نمونه حدود هر ۳۰ دقیقه. این فایل برای حفظ قیمت‌های تاریخ‌دار خود Karen Fuse بدون تکرار جزئیات همه Sourceها استفاده می‌شود.

## tgju_history.json

OHLC روزانه Provider TGJU برای:

- `gold` = طلای ۱۸ عیار
- `usd` = دلار
- `xau` = اونس جهانی

برای بازه‌های بلند نمودار استفاده می‌شود، به‌خصوص زمانی که آرشیو خود Karen Fuse هنوز پوشش کافی ندارد.
