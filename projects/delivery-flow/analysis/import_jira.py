"""
Turn a Jira export into the three clean tables the SQL analysis reads.

Works the same on the simulated export in data/jira-export/ and on a real one.

Inputs (column names as Jira writes them):
  issues CSV          required: Issue key, Issue Type, Priority, Created
                      optional: Summary, Component/s (used as the stream)
  status changes CSV  required: Issue key, From Status, To Status, Changed
  flags CSV           optional: Issue key, Flagged, Unflagged (blank = still flagged)

Jira's standard CSV export has the issues but not the status history. The
history comes from each issue's changelog (Jira REST API, field "status");
see README.md for the exact steps.

Your workflow's status names are mapped onto six stages:
  Backlog, Ready, In Progress, Code Review, QA, Done
Any status mapped to "Blocked" becomes a blocked period instead of a stage,
and the item stays in the stage it was in. Pass --status-map with a JSON file
to add your own names; the script stops and lists any status it cannot map.

Outputs (in --out):
  items.csv           key, type, stream, priority, summary, created
  status_history.csv  key, from_status, to_status, changed_at
  blocked.csv         key, blocked_start, blocked_end

Run:  python analysis/import_jira.py --in data/jira-export --out data
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

STAGES = ["Backlog", "Ready", "In Progress", "Code Review", "QA", "Done"]

DEFAULT_MAP = {
    # canonical names map to themselves
    **{s.lower(): s for s in STAGES},
    # common Jira workflow names
    "to do": "Backlog", "open": "Backlog", "new": "Backlog", "backlog": "Backlog",
    "selected for development": "Ready", "ready for development": "Ready", "ready for dev": "Ready",
    "in development": "In Progress", "doing": "In Progress",
    "in review": "Code Review", "review": "Code Review", "peer review": "Code Review",
    "testing": "QA", "in testing": "QA", "in qa": "QA", "ready for qa": "QA",
    "closed": "Done", "resolved": "Done", "released": "Done",
    "blocked": "Blocked", "on hold": "Blocked", "waiting": "Blocked",
}

DATE_FORMATS = [
    "%d/%b/%y %I:%M %p",      # Jira CSV default: 05/Jan/26 9:14 AM
    "%d/%b/%Y %I:%M %p",
    "%d/%b/%y %H:%M",
    "%Y-%m-%dT%H:%M:%S.%f%z",  # Jira REST API: 2026-01-05T09:14:00.000+0100
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
]


def parse_date(raw: str) -> datetime | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=None)   # keep local clock time, drop the offset
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date: {raw!r}. Add its format to DATE_FORMATS.")


def read_rows(path: Path, required: list[str]) -> list[dict[str, str]]:
    """Read a CSV whose header may repeat a column (Jira repeats Component/s)."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        missing = [c for c in required if c not in header]
        if missing:
            sys.exit(f"{path.name} is missing required columns: {', '.join(missing)}")
        rows = []
        for raw in reader:
            row: dict[str, str] = {}
            for name, value in zip(header, raw):
                if value.strip() and not row.get(name):
                    row[name] = value.strip()   # first non-empty value wins
            rows.append(row)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="src", type=Path, required=True, help="folder with issues.csv, status_changes.csv, flags.csv")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--status-map", type=Path, help="JSON object: {\"Your status\": \"Code Review\", ...}")
    args = ap.parse_args()

    status_map = dict(DEFAULT_MAP)
    if args.status_map:
        status_map.update({k.lower(): v for k, v in json.loads(args.status_map.read_text()).items()})

    # ── items ──────────────────────────────────────────────────────────────
    issues = read_rows(args.src / "issues.csv", ["Issue key", "Issue Type", "Priority", "Created"])
    items = []
    for r in issues:
        items.append({
            "key": r["Issue key"],
            "type": r["Issue Type"],
            "stream": r.get("Component/s", "(none)"),
            "priority": r.get("Priority", "Medium"),
            "summary": r.get("Summary", ""),
            "created": parse_date(r["Created"]),
        })
    created = {i["key"]: i["created"] for i in items}

    # ── status history ─────────────────────────────────────────────────────
    changes = read_rows(args.src / "status_changes.csv", ["Issue key", "From Status", "To Status", "Changed"])
    unknown = sorted({c[s] for c in changes for s in ("From Status", "To Status")
                      if c[s].lower() not in status_map})
    if unknown:
        sys.exit("Map these statuses with --status-map before importing: " + ", ".join(unknown))

    per_item = defaultdict(list)
    for c in changes:
        if c["Issue key"] in created:
            per_item[c["Issue key"]].append((parse_date(c["Changed"]),
                                             status_map[c["From Status"].lower()],
                                             status_map[c["To Status"].lower()]))

    history, blocked = [], []
    for key, rows in per_item.items():
        rows.sort()
        stage = rows[0][1] if rows[0][1] != "Blocked" else "Backlog"
        block_start = None
        for ts, _frm, to in rows:
            if to == "Blocked":                      # a Blocked status is a flag, not a stage
                block_start = block_start or ts
                continue
            if block_start is not None:
                blocked.append({"key": key, "blocked_start": block_start, "blocked_end": ts})
                block_start = None
            if to != stage:                          # collapse moves between statuses that map to one stage
                history.append({"key": key, "from_status": stage, "to_status": to, "changed_at": ts})
                stage = to
        if block_start is not None:
            blocked.append({"key": key, "blocked_start": block_start, "blocked_end": None})

    # ── flags (Jira's "Flagged" impediment field) ──────────────────────────
    flags_path = args.src / "flags.csv"
    if flags_path.exists():
        for r in read_rows(flags_path, ["Issue key", "Flagged"]):
            if r["Issue key"] in created:
                blocked.append({"key": r["Issue key"], "blocked_start": parse_date(r["Flagged"]),
                                "blocked_end": parse_date(r.get("Unflagged", ""))})

    # ── write ──────────────────────────────────────────────────────────────
    args.out.mkdir(parents=True, exist_ok=True)
    iso = lambda dt: dt.strftime("%Y-%m-%d %H:%M:%S") if dt else ""

    def write(name: str, cols: list[str], rows: list[dict]) -> None:
        with open(args.out / name, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(cols)
            for row in rows:
                w.writerow([iso(row[c]) if isinstance(row[c], datetime) or row[c] is None else row[c] for c in cols])

    write("items.csv", ["key", "type", "stream", "priority", "summary", "created"], items)
    write("status_history.csv", ["key", "from_status", "to_status", "changed_at"],
          sorted(history, key=lambda h: (h["key"], h["changed_at"])))
    write("blocked.csv", ["key", "blocked_start", "blocked_end"],
          sorted(blocked, key=lambda b: (b["key"], b["blocked_start"])))
    print(f"imported {len(items)} items, {len(history)} status changes, {len(blocked)} blocked periods")


if __name__ == "__main__":
    main()
