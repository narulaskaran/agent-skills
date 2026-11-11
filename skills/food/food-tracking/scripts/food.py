#!/usr/bin/env python3
"""Food diary command line: the one way to read and write the diary database.

Standard library only. The database is plain SQLite, so another agent or a web
page can share the same file.

Environment:
  FOOD_DB       path to the database (default: $NANO_DATA_DIR/food/food.db)
  FOOD_TZ_URL   optional URL returning {"timezone": "<IANA zone>"}; wins when reachable
  TZ            fallback timezone
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

DATA_DIR = Path(os.environ.get("NANO_DATA_DIR", "/data"))
DB_PATH = Path(os.environ.get("FOOD_DB") or DATA_DIR / "food" / "food.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    food_name TEXT NOT NULL,
    calories INTEGER NOT NULL,
    protein INTEGER NOT NULL,
    fiber INTEGER NOT NULL,
    meal_time TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text',
    raw_input TEXT,
    status TEXT NOT NULL DEFAULT 'complete'
);
CREATE TABLE IF NOT EXISTS targets (
    date TEXT PRIMARY KEY,
    calories INTEGER NOT NULL,
    protein INTEGER NOT NULL,
    fiber INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS weight_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logged_at TEXT NOT NULL DEFAULT (datetime('now')),
    weight_lbs REAL NOT NULL,
    source TEXT DEFAULT 'user'
);
CREATE TABLE IF NOT EXISTS tracking_days (
    date TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('tracked','not_tracked')),
    note TEXT,
    updated_at TEXT NOT NULL
);
"""


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(2)


def timezone():
    url = os.environ.get("FOOD_TZ_URL")
    if url:
        try:
            with urllib.request.urlopen(url, timeout=4) as response:
                return ZoneInfo(json.load(response)["timezone"])
        except Exception:
            pass
    try:
        name = json.loads((DATA_DIR / "settings.json").read_text()).get("timezone")
        if name:
            return ZoneInfo(name)
    except Exception:
        pass
    return ZoneInfo(os.environ.get("TZ") or "UTC")


def now():
    return datetime.now(timezone()).replace(microsecond=0)


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    return db


def parse_time(text, current):
    """Accepts HH:MM (today), 'YYYY-MM-DD HH:MM', 'YYYY-MM-DDTHH:MM[:SS]', or 'yesterday HH:MM'."""
    if not text:
        return current
    text = text.strip()
    m = re.fullmatch(r"(yesterday\s+)?(\d{1,2}):(\d{2})", text, re.I)
    if m:
        day = current - timedelta(days=1) if m.group(1) else current
        when = day.replace(hour=int(m.group(2)), minute=int(m.group(3)), second=0)
        if not m.group(1) and when > current + timedelta(minutes=5):
            fail(f"{text} is still in the future today ({current:%H:%M} now). "
                 "Ask whether they mean yesterday, then pass 'yesterday HH:MM' or a full date.")
        return when
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?", text)
    if m:
        d = datetime.strptime(m.group(1), "%Y-%m-%d")
        return current.replace(year=d.year, month=d.month, day=d.day, hour=int(m.group(2)), minute=int(m.group(3)), second=0)
    fail(f"cannot read time '{text}'. Use HH:MM, 'yesterday HH:MM' or 'YYYY-MM-DD HH:MM'.")


def stamp(when):
    return when.isoformat(timespec="seconds")  # e.g. 2026-11-10T21:45:00-05:00


def day_summary(db, day):
    # A row's own date prefix defines its calendar day; never convert through UTC.
    rows = db.execute(
        "SELECT id, substr(meal_time, 12, 5) AS t, food_name, calories, protein, fiber, source_type "
        "FROM entries WHERE substr(meal_time, 1, 10) = ? ORDER BY meal_time, id", (day,)).fetchall()
    total = {k: sum(r[k] for r in rows) for k in ("calories", "protein", "fiber")}
    target = db.execute("SELECT calories, protein, fiber FROM targets WHERE date = ?", (day,)).fetchone()
    lines = [f"{day}: {len(rows)} entries"]
    for r in rows:
        lines.append(f"  #{r['id']} {r['t']} {r['food_name']} | {r['calories']} cal, {r['protein']}g protein, {r['fiber']}g fiber ({r['source_type']})")
    lines.append(f"Total: {total['calories']} cal, {total['protein']}g protein, {total['fiber']}g fiber")
    if target:
        lines.append(f"Target: {target['calories']} cal, {target['protein']}g protein, {target['fiber']}g fiber")
        lines.append(f"Left: {target['calories'] - total['calories']} cal, "
                     f"{target['protein'] - total['protein']}g protein, {target['fiber'] - total['fiber']}g fiber")
    else:
        lines.append("Target: none set for this day")
    return "\n".join(lines)


def cmd_now(args):
    current = now()
    print(f"{stamp(current)} ({current.tzinfo.key})")


def cmd_log(args):
    current = now()
    when = parse_time(args.at, current)
    db = connect()
    day = stamp(when)[:10]
    twin = db.execute(
        "SELECT id, substr(meal_time, 12, 5) AS t FROM entries WHERE substr(meal_time, 1, 10) = ? AND lower(food_name) = lower(?)",
        (day, args.name)).fetchone()
    if twin and not args.force:
        fail(f"'{args.name}' is already logged on {day} at {twin['t']} (#{twin['id']}). "
             "If this is a second serving, run again with --force.")
    cursor = db.execute(
        "INSERT INTO entries (food_name, calories, protein, fiber, meal_time, source_type, raw_input, status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'complete')",
        (args.name, args.cal, args.protein, args.fiber, stamp(when), args.source, args.raw))
    db.commit()
    print(f"Logged #{cursor.lastrowid}: {args.name} at {stamp(when)}")
    print(day_summary(db, day))


def cmd_day(args):
    print(day_summary(connect(), args.date or stamp(now())[:10]))


def cmd_prior(args):
    rows = connect().execute(
        "SELECT food_name, calories, protein, fiber, COUNT(*) AS n, MAX(substr(meal_time, 1, 10)) AS last "
        "FROM entries WHERE food_name LIKE ? GROUP BY lower(food_name), calories, protein, fiber "
        "ORDER BY last DESC LIMIT ?", (f"%{args.query}%", args.limit)).fetchall()
    if not rows:
        print("No earlier entries match.")
    for r in rows:
        print(f"{r['food_name']} | {r['calories']} cal, {r['protein']}g protein, {r['fiber']}g fiber | logged {r['n']}x, last {r['last']}")


def cmd_edit(args):
    db = connect()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (args.id,)).fetchone()
    if not row:
        fail(f"no entry #{args.id}")
    changes = {"food_name": args.name, "calories": args.cal, "protein": args.protein, "fiber": args.fiber}
    if args.at:
        changes["meal_time"] = stamp(parse_time(args.at, now()))
    changes = {k: v for k, v in changes.items() if v is not None}
    if not changes:
        fail("nothing to change")
    db.execute(f"UPDATE entries SET {', '.join(f'{k} = ?' for k in changes)} WHERE id = ?", (*changes.values(), args.id))
    db.commit()
    after = db.execute("SELECT meal_time FROM entries WHERE id = ?", (args.id,)).fetchone()
    print(f"Updated #{args.id}: {', '.join(f'{k}={v}' for k, v in changes.items())}")
    print(day_summary(db, after["meal_time"][:10]))


def cmd_delete(args):
    db = connect()
    row = db.execute("SELECT food_name, meal_time FROM entries WHERE id = ?", (args.id,)).fetchone()
    if not row:
        fail(f"no entry #{args.id}")
    db.execute("DELETE FROM entries WHERE id = ?", (args.id,))
    db.commit()
    print(f"Deleted #{args.id}: {row['food_name']}")
    print(day_summary(db, row["meal_time"][:10]))


def cmd_weight(args):
    db = connect()
    if args.lbs is not None:
        db.execute("INSERT INTO weight_log (logged_at, weight_lbs, source) VALUES (?, ?, 'user')", (stamp(now()), args.lbs))
        db.commit()
        print(f"Logged weight {args.lbs} lb")
    for r in db.execute("SELECT substr(logged_at, 1, 10) AS d, weight_lbs, source FROM weight_log ORDER BY logged_at DESC LIMIT ?", (args.last,)):
        print(f"{r['d']} {r['weight_lbs']} lb ({r['source']})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("now", help="current local time and timezone").set_defaults(run=cmd_now)

    p = sub.add_parser("log", help="add one entry, then print the day's totals")
    p.add_argument("name")
    p.add_argument("--cal", type=int, required=True)
    p.add_argument("--protein", type=int, required=True)
    p.add_argument("--fiber", type=int, required=True)
    p.add_argument("--at", help="HH:MM, 'yesterday HH:MM' or 'YYYY-MM-DD HH:MM' (default: now)")
    p.add_argument("--source", default="text", choices=["text", "image", "estimate", "packaged_lookup", "restaurant_lookup", "restaurant_estimate"])
    p.add_argument("--raw", help="the owner's own words, for the record")
    p.add_argument("--force", action="store_true", help="log even if the same food is already on that day")
    p.set_defaults(run=cmd_log)

    p = sub.add_parser("day", help="entries, totals, target and what is left for a day")
    p.add_argument("date", nargs="?", help="YYYY-MM-DD (default: today)")
    p.set_defaults(run=cmd_day)

    p = sub.add_parser("prior", help="how a food was logged before, to reuse its numbers")
    p.add_argument("query")
    p.add_argument("--limit", type=int, default=8)
    p.set_defaults(run=cmd_prior)

    p = sub.add_parser("edit", help="change fields of one entry")
    p.add_argument("id", type=int)
    p.add_argument("--name")
    p.add_argument("--cal", type=int)
    p.add_argument("--protein", type=int)
    p.add_argument("--fiber", type=int)
    p.add_argument("--at")
    p.set_defaults(run=cmd_edit)

    p = sub.add_parser("delete", help="remove one entry")
    p.add_argument("id", type=int)
    p.set_defaults(run=cmd_delete)

    p = sub.add_parser("weight", help="show recent weights; with a number, log one first")
    p.add_argument("lbs", nargs="?", type=float)
    p.add_argument("--last", type=int, default=5)
    p.set_defaults(run=cmd_weight)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
