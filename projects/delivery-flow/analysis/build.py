"""
Rebuild everything for the simulated data set, in order:
  1. simulate.py      writes a Jira-style export to data/jira-export/
  2. import_jira.py   turns it into data/items.csv, status_history.csv, blocked.csv
  3. run_analysis.py  runs sql/*.sql in DuckDB and writes data/flow.json

Run from projects/delivery-flow:  python analysis/build.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(*args: str) -> None:
    subprocess.run([sys.executable, *args], cwd=ROOT, check=True)


run("analysis/simulate.py")
run("analysis/import_jira.py", "--in", "data/jira-export", "--out", "data")
run("analysis/run_analysis.py", "--data", "data", "--out", "data/flow.json",
    "--start", "2026-01-05", "--end", "2026-07-05", "--change-date", "2026-04-13",
    "--wip-limits", "In Progress=5,Code Review=4,QA=3", "--simulated")
