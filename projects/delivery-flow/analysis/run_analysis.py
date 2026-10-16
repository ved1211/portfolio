"""
Run the SQL analysis in DuckDB and export what the case study page needs.

All the analysis lives in sql/*.sql, run in file order. This script only
sets the dates, runs those files, and writes the results to one JSON file.

Run (simulated data, the settings used on the page):
  python analysis/run_analysis.py --data data --out data/flow.json \
      --start 2026-01-05 --end 2026-07-05 --change-date 2026-04-13 \
      --wip-limits "In Progress=5,Code Review=4,QA=3" --simulated

Run (a real export, after import_jira.py):
  python analysis/run_analysis.py --data my-team --out my-team/flow.json
  (start and end default to the data; --change-date splits before and after
   a change you made, such as introducing WIP limits)
"""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent


def rows(con, sql: str) -> list[dict]:
    cur = con.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def num(x, digits: int = 2):
    return None if x is None else round(float(x), digits)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, required=True, help="folder with items.csv, status_history.csv, blocked.csv")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--start", type=date.fromisoformat)
    ap.add_argument("--end", type=date.fromisoformat)
    ap.add_argument("--change-date", type=date.fromisoformat)
    ap.add_argument("--wip-limits", default="", help='e.g. "In Progress=5,Code Review=4,QA=3"')
    ap.add_argument("--simulated", action="store_true", help="label the output as simulated data")
    args = ap.parse_args()

    con = duckdb.connect()
    hist = args.data.resolve() / "status_history.csv"
    first, last = con.execute(
        f"SELECT min(changed_at) FILTER (WHERE to_status = 'In Progress'), max(changed_at) FROM read_csv_auto('{hist}')"
    ).fetchone()
    start = args.start or (first.date() - timedelta(days=first.weekday()))   # the Monday on or before the first start
    end = args.end or last.date()
    con.execute("CREATE TABLE settings AS SELECT ?::DATE AS start_date, ?::DATE AS end_date, ?::DATE AS change_date",
                [start, end, args.change_date])

    for path in sorted((HERE / "sql").glob("*.sql")):
        con.execute(path.read_text().replace("__DATA_DIR__", str(args.data.resolve())))

    period = {"before": "before", "after": "after", "all": "all"}
    by_period = lambda table: {r["period"]: r for r in rows(con, f"SELECT * FROM {table}") if r["period"] in period}

    pct = by_period("cycle_time_percentiles")
    tis = by_period("time_in_stage")
    eff = by_period("flow_efficiency")
    blk = by_period("blocked_summary")
    weekly = rows(con, "SELECT week, week_start, finished FROM weekly_throughput ORDER BY week")
    daily = rows(con, "SELECT * FROM daily_board ORDER BY day")
    change_week = None
    if args.change_date:
        change_week = (args.change_date - start).days // 7 + 1

    types = sorted({r["type"] for r in rows(con, "SELECT DISTINCT type FROM items")})
    streams = sorted({r["stream"] for r in rows(con, "SELECT DISTINCT stream FROM items")})
    prios = ["Highest", "High", "Medium", "Low", "Lowest"]
    limits = {k.strip(): int(v) for k, v in (p.split("=") for p in args.wip_limits.split(",") if "=" in p)}

    out = {
        "meta": {
            "simulated": args.simulated,
            "note": "Simulated data. A fictional 9-person team; not from any real employer." if args.simulated else "",
            "start": start.isoformat(), "end": end.isoformat(),
            "changeDate": args.change_date.isoformat() if args.change_date else None,
            "changeWeek": change_week,
            "wipLimits": limits,
            "items": con.execute("SELECT count(*) FROM items").fetchone()[0],
        },
        "weekly": {
            "week": [r["week"] for r in weekly],
            "start": [r["week_start"].isoformat() for r in weekly],
            "finished": [r["finished"] for r in weekly],
        },
        "daily": {
            "day": [r["day"].isoformat() for r in daily],
            "backlog": [r["backlog"] for r in daily],
            "ready": [r["ready"] for r in daily],
            "inProgress": [r["in_progress"] for r in daily],
            "codeReview": [r["code_review"] for r in daily],
            "qa": [r["qa"] for r in daily],
            "wip": [r["wip"] for r in daily],
            "done": [r["done"] for r in daily],
        },
        "cycle": {
            "points": [[num(r["done_day"], 3), num(r["cycle_days"], 2), r["period"], r["type"], r["key"]]
                       for r in rows(con, """SELECT epoch(f.done_at - s.start_date) / 86400 AS done_day,
                                                     f.cycle_days, f.period, f.type, f.key
                                              FROM finished_items f, settings s ORDER BY f.done_at, f.key""")],
            "percentiles": {k: {"items": v["items"], "p50": num(v["p50"], 1), "p85": num(v["p85"], 1),
                                "p95": num(v["p95"], 1), "mean": num(v["mean_days"], 1)} for k, v in pct.items()},
        },
        "timeInStage": {k: {"items": v["items"], "inProgress": num(v["in_progress"]), "codeReview": num(v["code_review"]),
                            "qa": num(v["qa"]), "blocked": num(v["blocked"]), "other": num(v["other"]),
                            "cycle": num(v["cycle_days"])} for k, v in tis.items()},
        "flowEfficiency": {k: {"efficiency": num(v["efficiency"], 3), "waiting": num(v["waiting_share"], 3)}
                           for k, v in eff.items()},
        "blocked": {k: {"items": v["items"], "itemsBlocked": v["items_blocked"], "days": num(v["blocked_days"], 1),
                        "share": num(v["share_of_cycle_time"], 3), "longest": num(v["longest_block_days"], 1)}
                    for k, v in blk.items()},
        "aging": [{"key": r["key"], "type": r["type"], "stage": r["stage"], "age": num(r["age_days"], 1)}
                  for r in rows(con, "SELECT * FROM open_item_age")],
        "littlesLaw": {r["window_name"]: {"days": r["days"], "avgWip": num(r["avg_wip"], 1),
                                          "throughputPerDay": num(r["throughput_per_day"], 2),
                                          "avgCycle": num(r["avg_cycle_days"], 1),
                                          "predictedWip": num(r["predicted_wip"], 1)}
                       for r in rows(con, "SELECT * FROM littles_law")},
        "board": {
            "types": types, "streams": streams, "priorities": prios,
            "items": [[r["key"], types.index(r["type"]), streams.index(r["stream"]),
                       prios.index(r["priority"]) if r["priority"] in prios else 2,
                       r["created_day"], r["moves"] or [], r["blocks"] or []]
                      for r in rows(con, "SELECT * FROM board_items")],
        },
    }
    # The forecaster samples from the most recent 12 complete weeks.
    recent = weekly[-12:]
    out["forecast"] = {"fromWeek": recent[0]["week"], "toWeek": recent[-1]["week"],
                       "weeklyThroughput": [r["finished"] for r in recent]}

    # Sorted keys keep the file byte-identical between runs (DuckDB may return grouped rows in any order).
    args.out.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True))
    print(f"wrote {args.out} ({args.out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
