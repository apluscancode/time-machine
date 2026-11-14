#!/usr/bin/env python3
"""
Time Machine — data builder
============================
Builds `history.json`: a year-by-year snapshot of Iranian asset prices, so the
frontend can answer "what would 1,000,000 toman have become if invested in
year X?".

Sources
-------
TGJU summary-table history API (no key), one row per trading day, newest first:
    https://api.tgju.org/v1/market/indicator/summary-table-data/{sym}
        ?lang=fa&order_dir=desc&draw={n}&start={offset}&length={len}
    Row: [open, close, high, low, change_html, pct_html, greg_date, shamsi_date]
    Values are in RIALS -> /10 for Toman.

Verified symbol ids (Oct 2026):
    price_dollar_rl  free-market USD      (also ali: price_dollar)
    sekee            سکه امامی
    sekeb            سکه بهار آزاد
    geram18          طلا ۱۸ per gram
    mesghal          مثقال
    ons              اونس جهانی (USD)

Pagination: `start` is a row OFFSET and `draw` must increment with the page
(otherwise the server re-serves the first page and you loop forever).

Run:  python3 build_history.py
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
IRAN_TZ = timezone(timedelta(hours=3, minutes=30))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "history.json")

SYMBOLS = {
    "usd":    ("price_dollar_rl", "دلار آزاد", 0.1),
    "coin":   ("sekee", "سکه امامی", 0.1),
    "coin_bahar": ("sekeb", "سکه بهار آزاد", 0.1),
    "gold18": ("geram18", "طلا ۱۸ (هر گرم)", 0.1),
    "mesghal": ("mesghal", "مثقال", 0.1),
    # `ons` is quoted in USD per troy ounce (4,111.72 today) — NOT rials,
    # so it must NOT be divided by 10.
    "ounce":  ("ons", "اونس جهانی (دلار)", 1.0),
}

PAGE = 300
MAX_PAGES = 60


def _get(url, timeout=30, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:
            last = e
            time.sleep(1.5)
    raise last


def _num(v):
    try:
        return float(str(v).replace(",", "").replace("٬", "").strip())
    except (TypeError, ValueError):
        return None


def _shamsi_to_greg(sh):
    """'1405/07/28' -> '2026-10-20' (no external lib needed for display)."""
    if not sh or "/" not in sh:
        return None
    try:
        y, m, d = [int(x) for x in sh.split("/")]
    except ValueError:
        return None
    # Jalali -> Gregorian (standard algorithm)
    jy, jm, jd = y, m, d
    gy = jy + 621
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    leap = (gy % 4 == 0 and gy % 100 != 0) or gy % 400 == 0
    days_in_month[1] = 29 if leap else 28
    for _ in range(7):
        gy -= 1
        if jy < 0:
            break
    # (the loop above is a placeholder; use a direct conversion instead)
    return _jalali_to_gregorian(jy, jm, jd)


def _jalali_to_gregorian(jy, jm, jd):
    """Jalali (Shamsi) -> Gregorian (Gregorian) date, pure integer math."""
    jy += 1595
    days = (-355668 + (365 * jy) + (jy // 33) * 8 + ((jy % 33) + 3) // 4
            + jd + ((jm - 1) if jm < 7 else (jm - 7) * 30 + 186))
    gy = 400 * (days // 146097)
    days = days % 146097
    if days > 36524:
        days -= 1
        gy += 100 * (days // 36524)
        days = days % 36524
        if days >= 365:
            days += 1
    gy += 4 * (days // 1461)
    days = days % 1461
    if days > 365:
        gy += (days - 1) // 365
        days = (days - 1) % 365
    gd = days + 1
    sal_a = [0, 31, (29 if leap_gregorian(gy) else 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 0
    while gm < 13 and gd > sal_a[gm]:
        gd -= sal_a[gm]
        gm += 1
    return f"{gy:04d}-{gm:02d}-{gd:02d}"


def leap_gregorian(gy):
    return (gy % 4 == 0 and gy % 100 != 0) or gy % 400 == 0


def _greg_to_shamsi(gy, gm, gd):
    """Gregorian -> Jalali, pure integer math."""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy - 1600
    gm2 = gm - 1
    gd2 = gd - 1
    g_day_no = 365 * gy2 + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400
    g_day_no += g_d_m[gm2] + gd2
    if gm > 2 and leap_gregorian(gy):
        g_day_no += 1
    j_day_no = g_day_no - 79
    j_np = j_day_no // 12053
    j_day_no %= 12053
    jy = 979 + 33 * j_np + 4 * (j_day_no // 1461)
    j_day_no %= 1461
    if j_day_no >= 366:
        jy += (j_day_no - 1) // 365
        j_day_no = (j_day_no - 1) % 365
    for i in range(11):
        if j_day_no < (i * 31 if i < 6 else (i - 6) * 30 + 186):
            jm = i + 1
            break
    else:
        jm = 12
    jd = j_day_no - (jm - 1) * 31 if jm < 7 else j_day_no - (jm - 7) * 30 - 186
    return f"{jy:04d}/{jm:02d}/{jd:02d}"


def fetch_all(sym):
    """Fetch the full history for a symbol. Returns list of dicts (newest first).

    The API's `recordsTotal` is NOT the real end of the history — the server
    happily serves rows past it (e.g. the dollar goes back to 1391 while
    recordsTotal says 3982 rows ≈ 1394). So we page until the server returns
    an empty page, ignoring recordsTotal.
    """
    out = []
    seen_dates = set()
    start = 0
    page_no = 1
    while page_no <= MAX_PAGES:
        url = (f"https://api.tgju.org/v1/market/indicator/summary-table-data/{sym}"
               f"?lang=fa&order_dir=desc&draw={page_no}&start={start}&length={PAGE}")
        try:
            d = json.loads(_get(url))
        except Exception as e:
            print(f"      [{sym}] page {page_no} error: {e}")
            break
        rows = d.get("data") or []
        if not rows:
            break
        added = 0
        for r in rows:
            if not isinstance(r, list) or len(r) < 8:
                continue
            date = r[6]
            if date in seen_dates:
                continue
            seen_dates.add(date)
            close = _num(r[1])
            if close is None:
                continue
            out.append({
                "date": date,                  # '2026/10/20'
                "shamsi": r[7],                # '1405/07/28'
                "close": close,                # raw close (rial for Iran, USD for ounce)
            })
            added += 1
        start += len(rows)
        if added == 0:
            break
        time.sleep(0.25)
        page_no += 1
    return out


def yearly_snapshot(rows):
    """For each Jalali year: first close (start of year), last close, and the
    average. Returned as a dict keyed by the Jalali year."""
    by_year = {}
    for r in rows:
        sh = r.get("shamsi") or ""
        if "/" not in sh:
            continue
        y = int(sh.split("/")[0])
        by_year.setdefault(y, []).append(r)
    out = {}
    for y, rs in by_year.items():
        # rows are newest-first -> rs[0] is the latest of that year
        first_of_year = rs[-1]     # the OLDEST close in that year
        last_of_year = rs[0]      # the NEWEST close in that year
        out[y] = {
            "start": first_of_year["close"],       # value at the start of the year
            "end": last_of_year["close"],           # value at the end of the year
            "avg": sum(x["close"] for x in rs) / len(rs),
            "min": min(x["close"] for x in rs),
            "max": max(x["close"] for x in rs),
            "n": len(rs),
            "start_date": first_of_year["shamsi"],
            "end_date": last_of_year["shamsi"],
        }
    return out


def main():
    now = datetime.now(IRAN_TZ)
    result = {
        "generated_at": now.isoformat(),
        "generated_at_display": now.strftime("%Y-%m-%d %H:%M") + " Iran",
        "assets": {},
        "errors": [],
    }

    for key, (sym, label, scale) in SYMBOLS.items():
        try:
            rows = fetch_all(sym)
            if not rows:
                result["errors"].append(f"{sym}: no data")
                print(f"  {label:<18} {sym:<16} NO DATA")
                continue
            # convert rial -> toman for the Iranian instruments (scale 0.1)
            for r in rows:
                r["close"] *= scale
            years = yearly_snapshot(rows)
            oldest = min(years.keys())
            newest = max(years.keys())
            result["assets"][key] = {
                "label": label, "symbol": sym,
                "years": {str(k): v for k, v in sorted(years.items())},
                "y_min": oldest, "y_max": newest,
                "latest": rows[0]["close"],
                "latest_date": rows[0]["shamsi"],
            }
            print(f"  {label:<18} {sym:<16} {len(rows):>5} rows  "
                  f"years {oldest}–{newest}  latest={rows[0]['close']:,.0f}")
        except Exception as e:
            result["errors"].append(f"{sym}: {type(e).__name__}: {e}")
            print(f"  {label:<18} {sym:<16} ERR {e}")

    # --- backfill the dollar for the years TGJU has no series for (1357-1389) ---
    backfill_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "dollar_history.json")
    if os.path.exists(backfill_path) and "usd" in result["assets"]:
        with open(backfill_path) as f:
            bf = json.load(f).get("prices", {})
        usd = result["assets"]["usd"]
        added = 0
        for ys, price in bf.items():
            y = int(ys)
            if str(y) in usd["years"]:
                continue
            usd["years"][str(y)] = {
                "start": price, "end": price, "avg": price,
                "min": price, "max": price, "n": 1,
                "start_date": None, "end_date": None,
                "source": "backfill",
            }
            added += 1
        usd["years"] = {k: usd["years"][k] for k in sorted(usd["years"], key=int)}
        usd["y_min"] = min(int(k) for k in usd["years"])
        print(f"  dollar backfill    +{added} years -> from {usd['y_min']}")

    # --- derive gold-18 and coin for the years TGJU has no series for ---
    #   gold18 = ounce_usd * usd_toman * (0.75 / 31.1035)
    #   coin  = gold18 * 8.133 grams
    # The ounce series reaches back to 1358 and the dollar (after the
    # backfill) to 1357, so gold and coin can be derived all the way back.
    G = 0.75 / 31.1035
    EMAMI_G = 8.133
    if "ounce" in result["assets"] and "usd" in result["assets"]:
        ons_years = result["assets"]["ounce"]["years"]
        usd_years = result["assets"]["usd"]["years"]
        derived = {}
        for ys in sorted(set(ons_years) & set(usd_years), key=int):
            y = int(ys)
            oe = ons_years[ys]["end"]
            ue = usd_years[ys]["end"]
            if not oe or not ue:
                continue
            g = oe * ue * G
            derived[y] = {"gold18": g, "coin": g * EMAMI_G}
        for key, grams in (("gold18", None), ("coin", None)):
            if key not in result["assets"]:
                continue
            asset = result["assets"][key]
            added = 0
            for y, vals in derived.items():
                if str(y) in asset["years"]:
                    continue
                v = vals[key]
                asset["years"][str(y)] = {
                    "start": v, "end": v, "avg": v, "min": v, "max": v, "n": 1,
                    "start_date": None, "end_date": None,
                    "source": "derived",
                }
                added += 1
            if added:
                asset["years"] = {k: asset["years"][k] for k in sorted(asset["years"], key=int)}
                asset["y_min"] = min(int(k) for k in asset["years"])
                print(f"  {key:<18} derived +{added} years -> from {asset['y_min']}")

    with open(OUT, "w") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"\nwrote {OUT} ({len(result['assets'])} assets)")
    if result["errors"]:
        print("errors:", result["errors"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
