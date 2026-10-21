# Supplier performance: a procurement dashboard in Power BI

> **Simulated data.** Built on simulated data, modelled on problems from my work in program
> delivery. The company, its plants, suppliers and materials are fictional. Nothing in this folder
> comes from Greenox or any other employer.

A procurement dashboard for a fictional mid-sized German manufacturer of electronic control units
(ECUs) with two plants, built the way a real one should be: a star schema, Power Query for the
data preparation and DAX for the measures. I build the Power BI file myself in Power BI Desktop;
this folder holds everything needed to build and check it.

Live case study: https://ved1211.github.io/portfolio/projects/supplier-performance/

## What is in this folder

```
index.html, page.ts, page.css,   the case study page (built by Vite with the rest of the site)
charts.ts, scorecard.ts, types.ts
data/
  DimSupplier.csv        45 suppliers in 11 countries
  DimMaterial.csv        300 materials in six categories
  DimPlant.csv           the two plants
  DimDate.csv            one row per day, 2024-01-01 to 2026-06-30
  FactPOLine.csv         about 6,000 purchase order lines, January 2024 to December 2025
  FactGoodsReceipt.csv   about 6,200 goods receipts
  kpis.json              every KPI from kpis.sql, for the case study page
analysis/
  simulate.py            writes the CSV files (fixed random seed)
  kpis.sql               the KPIs in SQL for DuckDB, with plain-English comments
  run_kpis.py            runs kpis.sql, writes kpis.json, fills the check table in the guide
  build.py               runs both scripts in order
powerbi/
  BUILD_GUIDE.md         step-by-step build, the numbers to check against, interview questions
  measures.dax           every measure, with a comment on what it means
  theme.json             the portfolio's colours as a Power BI theme
```

## Run it

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r projects/supplier-performance/requirements.txt
cd projects/supplier-performance
../../.venv/bin/python analysis/build.py
```

The seed is fixed, so every run writes the same files, byte for byte.

## Adding the Power BI screenshots

The case study page has four empty frames in the section "The Power BI report". Once the report is
built, save one PNG per page as `screenshots/overview.png`, `scorecard.png`, `risk.png` and
`detail.png`, and replace each frame in `index.html`, for example:

```html
<figure class="sp-shot"><img src="./screenshots/overview.png" alt="Overview page of the Power BI report"></figure>
```

Vite bundles the images with the page. Keep the sentence above the frames honest: it should only
say the report is finished once it is.

## The data model

The CSV files are shaped like an extract from an ERP system: one file of order lines and one of
goods receipts, plus four dimension tables. A PO line can arrive in more than one receipt, but every
delivery measure (on time, in full, lead time) is a property of the PO line. So the Power BI model
uses **one fact table at PO-line grain**: Power Query sums the receipts per line and merges the
result into the order lines, and the raw receipts table is not loaded. That keeps the model a clean
star, with no relationship between two fact tables. `kpis.sql` makes the same merge in SQL.

## How each KPI is defined

| KPI | Definition |
|---|---|
| Total Spend | Ordered quantity times the price paid, counted on the order date. |
| Spend YoY % | Change against the same period one year earlier. |
| OTIF % | Share of PO lines due by the data cut-off that arrived on or before the promised date and in the full quantity. Due lines that have not arrived count as failures. |
| Average Lead Time | Days from order date to the last goods receipt, for lines that arrived. |
| Lead Time Variability | Population standard deviation of that lead time, in days. |
| Reject Rate % | Units rejected at incoming inspection divided by units received. |
| Price Variance % | Spend at the price paid minus spend at standard price, divided by spend at standard price. |
| Single-Source Spend at Risk | Spend on materials that only one approved supplier can deliver. |
| Supplier Score | A weighted average of four 0 to 100 parts (delivery, quality, price, risk), with weights set by sliders in the report. |

## The simulated company

`simulate.py` builds a plausible purchasing history with a few patterns put in on purpose:

- Two suppliers whose on-time delivery gets worse month by month.
- Semiconductors ordered in 2025 Q2 come with much longer lead times and a price premium, like an
  allocation shortage.
- One critical microcontroller is single-sourced and is the largest single line of spend.
- Spend is concentrated: the top 10 suppliers carry about 70% of it.
- One supplier in the highest risk tier has an overdue sustainability risk assessment.

**Risk tiers are invented.** `CountryRiskTier` describes logistics exposure only (Low: delivered by
truck within Europe, Medium: transatlantic, High: Asian sea freight). It is not an assessment of any
country. `DueDiligenceStatus` imitates the supplier risk assessments that companies covered by the
German Supply Chain Due Diligence Act (LkSG) track; nothing here is a statement about what the act
requires.

## Limitations

- The data is simulated, so the patterns show what the dashboard can find, not facts about a real
  company.
- All prices are in euros; a real extract would need currency conversion.
- OTIF is counted per order line, not weighted by value or quantity, and allows no early or late
  tolerance window. Many companies allow a window of a few days.
