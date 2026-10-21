"""
Rebuild everything for the simulated data set, in order:
  1. simulate.py   writes the star schema CSVs to data/
  2. run_kpis.py   runs kpis.sql in DuckDB, writes data/kpis.json and refreshes
                   the "Check your build" table in powerbi/BUILD_GUIDE.md

Run from projects/supplier-performance:  python analysis/build.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

for script in ("analysis/simulate.py", "analysis/run_kpis.py"):
    subprocess.run([sys.executable, script], cwd=ROOT, check=True)
