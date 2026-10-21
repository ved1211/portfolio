"""
Run analysis/kpis.sql in DuckDB and write the results out.

  data/kpis.json             every KPI view, for the case study page
  powerbi/BUILD_GUIDE.md     the "Check your build" table is rewritten between
                             the <!-- check:start --> and <!-- check:end --> markers

All the logic is in kpis.sql. This script only runs it, rounds the numbers and
writes them, with sorted keys so the files are identical on every run.

Run:  python analysis/run_kpis.py   (from projects/supplier-performance)
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
VIEWS = {
    "overall": "SELECT * FROM kpi_overall",
    "suppliers": "SELECT * FROM kpi_supplier ORDER BY spend_rank",
    "pareto": "SELECT * FROM kpi_pareto",
    "monthly": "SELECT * FROM kpi_monthly",
    "supplierQuarter": "SELECT * FROM kpi_supplier_quarter",
    "worsening": "SELECT * FROM kpi_worsening",
    "semisLeadTime": "SELECT * FROM kpi_semis_lead_time",
    "riskMatrix": "SELECT * FROM kpi_risk_matrix",
    "singleSource": "SELECT * FROM kpi_single_source",
    "category": "SELECT * FROM kpi_category",
}


def clean(v):
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, date):
        return v.isoformat()
    return v


def rows(con, sql: str) -> list[dict]:
    cur = con.execute(sql)
    cols = [c[0] for c in cur.description]
    return [{c: clean(x) for c, x in zip(cols, r)} for r in cur.fetchall()]


eur = lambda x: f"€{x:,.0f}"
eur_m = lambda x: f"€{x / 1e6:,.2f}M"
pct = lambda x, d=1: f"{x * 100:.{d}f}%"


def check_table(k: dict) -> str:
    o = k["overall"][0]
    top = k["suppliers"][:3]
    semis_q2 = next(r for r in k["semisLeadTime"] if r["quarter"] == "2025 Q2")
    semis_rest = [r["avg_lead_time_days"] for r in k["semisLeadTime"] if r["quarter"] < "2025 Q2"]
    w = k["worsening"]
    lines = [
        "| What to check | How to see it in Power BI | It must show |",
        "|---|---|---|",
        f"| Total Spend | Card, no filters | {eur(o['total_spend'])} ({eur_m(o['total_spend'])}) |",
        f"| Total Spend in 2024 and 2025 | Card, with a slicer on DimDate[Year] | {eur(o['spend_2024'])} and {eur(o['spend_2025'])} |",
        f"| Spend YoY % | Card, slicer on DimDate[Year] = 2025 | {pct(o['spend_yoy_2025'])} |",
        f"| PO lines | Table with COUNTROWS(FactPOLine) | {o['po_lines']:,} |",
        f"| Lines due by the cut-off ({o['cutoff_date']}) | [Due Lines] | {o['due_lines']:,} |",
        f"| OTIF % | Card, no filters | {pct(o['otif'])} |",
        f"| Average Lead Time | Card, no filters | {o['avg_lead_time_days']:.1f} days |",
        f"| Lead Time Variability | Card, no filters | {o['lead_time_stdev_days']:.1f} days |",
        f"| Reject Rate % | Card, no filters | {pct(o['reject_rate'], 2)} |",
        f"| Price Variance % | Card, no filters | {pct(o['price_variance'], 2)} |",
        f"| Single-Source Spend at Risk | Card, no filters | {eur(o['single_source_spend'])} ({eur_m(o['single_source_spend'])}) |",
    ]
    for s in top:
        lines.append(f"| Supplier {s['SupplierID']} ({s['SupplierName']}) | Scorecard row, default weights 40/30/20/10 | "
                     f"spend {eur_m(s['spend'])}, OTIF {pct(s['otif'])}, score {s['supplier_score']:.1f} |")
    lines.append(f"| Semiconductors ordered in 2025 Q2 | Average Lead Time, Category = Semiconductors, by YearQuarter | "
                 f"{semis_q2['avg_lead_time_days']:.1f} days (earlier quarters {min(semis_rest):.0f} to {max(semis_rest):.0f}) |")
    for r in w:
        lines.append(f"| OTIF of {r['SupplierID']} ({r['SupplierName']}) | OTIF % for that supplier, DimDate filtered to Jan to Jun 2024, then Jul to Dec 2025 | "
                     f"{pct(r['otif_first'])}, then {pct(r['otif_last'])} |")
    return "\n".join(lines)


def main() -> None:
    con = duckdb.connect()
    sql = (ROOT / "analysis" / "kpis.sql").read_text().replace("__DATA_DIR__", str(ROOT / "data"))
    con.execute(sql)
    kpis = {name: rows(con, q) for name, q in VIEWS.items()}
    kpis["meta"] = {"simulated": True,
                    "note": "Simulated data. A fictional ECU manufacturer; not from Greenox or any real company."}
    out = ROOT / "data" / "kpis.json"
    out.write_text(json.dumps(kpis, separators=(",", ":"), sort_keys=True, ensure_ascii=False))
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")

    guide = ROOT / "powerbi" / "BUILD_GUIDE.md"
    if guide.exists():
        text = guide.read_text()
        new = re.sub(r"(<!-- check:start -->\n)(?:.*?\n)?(<!-- check:end -->)",
                     lambda m: m.group(1) + check_table(kpis) + "\n" + m.group(2), text, flags=re.S)
        if new != text:
            guide.write_text(new)
            print("updated the check table in powerbi/BUILD_GUIDE.md")
    print(check_table(kpis))


if __name__ == "__main__":
    main()
