# Build guide: Supplier performance in Power BI

> **Simulated data.** Built on simulated data, modelled on problems from my work in program
> delivery. The company, its plants, suppliers and materials are fictional. Nothing in this folder
> comes from Greenox or any other employer.

This guide walks through building the report in Power BI Desktop from the CSV files in `data/`.
It is written for someone who has built a Power BI report before but not necessarily a star
schema with DAX measures. Plan on three to four hours. Every number the finished report shows
can be checked against the SQL output in section 11.

**Words used in this guide**

- **Star schema:** a data model with one table of events in the middle (the *fact* table, here
  purchase order lines) and descriptive tables around it (the *dimension* tables: supplier,
  material, plant, date). Filters flow from the dimensions into the fact.
- **Power Query:** the part of Power BI that loads and reshapes data before it reaches the model.
  Its steps are recorded in a language called M.
- **DAX:** the formula language for measures and calculated columns in the model.
- **Measure:** a formula that is calculated for whatever is filtered on the page, such as OTIF %
  for one supplier in one month.
- **OTIF:** on time in full, the share of order lines that arrived by the promised date and in the
  full quantity.

## 1. What you are building

```
                 DimDate                       DimSupplier
            (one row per day)              (45 suppliers)
                    \                          /
                     \  OrderDate             / SupplierID
                      v                      v
     DimPlant  ----> FactPOLine  <----  DimMaterial
   (2 plants)       (one row per        (300 materials)
     PlantID         PO line, with      MaterialID
                     receipts merged in)
```

All four relationships are one-to-many, from the dimension (one) to the fact (many), with the
filter flowing in a single direction: from the dimension into the fact.

**Why one fact table when the data has two.** `FactPOLine.csv` holds what was ordered and
`FactGoodsReceipt.csv` holds what arrived; one PO line can arrive in two goods receipts. Every
delivery KPI (OTIF, lead time) is a property of the PO line: did *this line* arrive on time and
complete? So Power Query sums the receipts up per PO line and merges the result into
`FactPOLine`. The model then has one fact table, every measure works from one row per line, and
there is no relationship between two fact tables, which would make filters ambiguous. The raw
receipts table stays in Power Query as the source of the merge, but is not loaded into the model.

**The four report pages**

1. **Overview:** KPI cards, spend and OTIF by month, and the top suppliers as a Pareto chart.
2. **Supplier scorecard:** a ranked table with conditional formatting and weight sliders.
3. **Risk:** single-source exposure, risk tier against due-diligence status, and the semiconductor
   lead-time spike.
4. **Supplier detail:** a drill-through page for one supplier.

## 2. Before you import anything

1. **Set the import locale.** The CSV files use a full stop as the decimal separator (`6.6675`).
   If Windows is set to German, Power BI would read that as a thousands separator. Go to
   *File > Options and settings > Options > Current file > Regional settings* and set
   *Locale for import* to **English (United States)**. Dates are in `2024-01-15` format and read
   correctly in any locale.
2. **Turn off auto date/time.** In the same dialog, under *Current file > Data load*, untick
   **Auto date/time**. The model has its own date table, and the automatic one would add a hidden
   date table for every date column.

## 3. Import and shape the data in Power Query

### 3.1 Load the six files

*Home > Get data > Text/CSV*, pick `DimSupplier.csv`, then **Transform Data** (not Load). Repeat
for `DimMaterial.csv`, `DimPlant.csv`, `DimDate.csv`, `FactPOLine.csv` and
`FactGoodsReceipt.csv`. In each query, check that *Promoted Headers* is a step and fix the data
types as below (click the icon left of each column name).

| Table | Column | Type |
|---|---|---|
| DimSupplier | SupplierID, SupplierName, Country, CountryCode, Category, ISO9001, ISO14001, SingleSource, CountryRiskTier, DueDiligenceStatus | Text |
| DimSupplier | LastAssessmentDate | Date (blank for suppliers never assessed) |
| DimMaterial | MaterialID, MaterialName, Category, Critical, SingleSource | Text |
| DimMaterial | ApprovedSuppliers | Whole number |
| DimMaterial | StandardPriceEUR | Decimal number (the current 2025 standard price) |
| DimPlant | all columns | Text |
| DimDate | Date, MonthStart | Date |
| DimDate | Year, YearQuarterSort, MonthNumber, YearMonthSort, ISOWeek | Whole number |
| DimDate | Quarter, YearQuarter, MonthName, YearMonth, IsWorkday | Text |
| FactPOLine | POLineID, PONumber, SupplierID, MaterialID, PlantID | Text |
| FactPOLine | OrderDate, PromisedDate | Date |
| FactPOLine | OrderedQty | Whole number |
| FactPOLine | StandardUnitPriceEUR, PaidUnitPriceEUR, NetValueEUR, StandardValueEUR | Decimal number |
| FactGoodsReceipt | ReceiptID, POLineID | Text |
| FactGoodsReceipt | ReceiptDate | Date |
| FactGoodsReceipt | ReceivedQty, RejectedQty | Whole number |

`PONumber` is text on purpose: it is an identifier, and nobody should ever sum it.

### 3.2 Sum the receipts up per PO line

Right-click `FactGoodsReceipt` and choose **Reference**. Rename the new query `ReceiptSummary`.
Then *Home > Group By > Advanced*: group by `POLineID` and add four aggregations.

| New column | Operation | Column |
|---|---|---|
| LastReceiptDate | Max | ReceiptDate |
| ReceivedQty | Sum | ReceivedQty |
| RejectedQty | Sum | RejectedQty |
| Receipts | Count rows | |

The M code of that step should read:

```m
= Table.Group(Source, {"POLineID"}, {
    {"LastReceiptDate", each List.Max([ReceiptDate]), type nullable date},
    {"ReceivedQty", each List.Sum([ReceivedQty]), type nullable number},
    {"RejectedQty", each List.Sum([RejectedQty]), type nullable number},
    {"Receipts", each Table.RowCount(_), Int64.Type}})
```

### 3.3 Merge the summary into FactPOLine and add the delivery columns

In `FactPOLine`: *Home > Merge Queries*, match `POLineID` with `ReceiptSummary[POLineID]`, join
kind **Left Outer** (keep every PO line, including those that have not arrived yet). Expand the new
column and tick `LastReceiptDate`, `ReceivedQty`, `RejectedQty` and `Receipts` (untick "Use
original column name as prefix").

Then open the *Advanced Editor* and add these steps after the expand step. The first line finds the
data cut-off: the last day anything was received.

```m
    DataCutoff = List.Max(FactGoodsReceipt[ReceiptDate]),
    AddLeadTime = Table.AddColumn(Expanded, "LeadTimeDays",
        each if [LastReceiptDate] = null then null else Duration.Days([LastReceiptDate] - [OrderDate]),
        Int64.Type),
    AddIsDue = Table.AddColumn(AddLeadTime, "IsDue",
        each [PromisedDate] <= DataCutoff, type logical),
    AddOnTime = Table.AddColumn(AddIsDue, "OnTime",
        each [LastReceiptDate] <> null and [LastReceiptDate] <= [PromisedDate], type logical),
    AddInFull = Table.AddColumn(AddOnTime, "InFull",
        each [ReceivedQty] <> null and [ReceivedQty] >= [OrderedQty], type logical)
in
    AddInFull
```

(`Expanded` is the name of your expand step; use whatever name Power Query gave it.)

What the new columns mean:

- **LeadTimeDays:** days from order to the last receipt. Empty if nothing has arrived.
- **IsDue:** the promised date has passed by the cut-off, so the line can be judged.
- **OnTime:** everything arrived on or before the promised date.
- **InFull:** at least the ordered quantity arrived.

### 3.4 Keep the receipts out of the model

Right-click `FactGoodsReceipt` and untick **Enable load**, then do the same for `ReceiptSummary`.
Both queries still run (FactPOLine needs them), but neither appears as a table in the model, so the
model stays a clean star. Click **Close & Apply**.

## 4. The date table

1. Select `DimDate` in the Data view, then *Table tools > Mark as date table* and choose the `Date`
   column. This tells Power BI that `DimDate` is the calendar, which time functions such as
   `SAMEPERIODLASTYEAR` need. It only works because the table has one row for every day with no gaps.
2. Fix the sort orders so months do not sort alphabetically: select `MonthName` and set
   *Column tools > Sort by column* to `MonthNumber`. Do the same for `YearMonth` (sort by
   `YearMonthSort`) and `YearQuarter` (sort by `YearQuarterSort`).

## 5. Relationships

Open the Model view. Power BI may have guessed some relationships already; delete any that are not
in this list, and create the missing ones by dragging the column from the dimension onto the fact.

| From (one) | To (many) | Cardinality | Cross filter direction | Active |
|---|---|---|---|---|
| DimSupplier[SupplierID] | FactPOLine[SupplierID] | One to many | Single | Yes |
| DimMaterial[MaterialID] | FactPOLine[MaterialID] | One to many | Single | Yes |
| DimPlant[PlantID] | FactPOLine[PlantID] | One to many | Single | Yes |
| DimDate[Date] | FactPOLine[OrderDate] | One to many | Single | Yes |
| DimDate[Date] | FactPOLine[PromisedDate] | One to many | Single | **No** (optional) |

The last one is optional. A table can only have one active relationship to the date table, so the
promised date link stays inactive and only the measure `OTIF % by Promised Date` switches it on.

Note that DimSupplier and DimMaterial both have a `Category` column. On the scorecard use
`DimSupplier[Category]`; for spend by material type use `DimMaterial[Category]`.

## 6. Measures

1. *Home > Enter data*, name the table `_Measures`, load it. The underscore keeps it at the top of
   the field list. Delete its default column once it holds a measure.
2. Open `powerbi/measures.dax`. For each block, select `_Measures`, click **New measure** and paste
   the block from the measure name down. The comment above each block gives its format.
3. Group the measures in display folders: select a measure, then in the Model view's *Properties*
   pane type the folder name into **Display folder**. Use `Spend`, `Delivery`, `Quality`, `Price`,
   `Risk` and `Score`, as marked in the file.
4. Add the calculated column `Risk Points` to `DimSupplier` (*Table tools > New column*), from the
   section near the end of the file. It is a column because it is a fixed fact about each supplier.

## 7. What-if parameters for the score weights

*Modeling > New parameter > Numeric range*, four times:

| Name | Minimum | Maximum | Increment | Default |
|---|---|---|---|---|
| Delivery Weight | 0 | 100 | 5 | 40 |
| Quality Weight | 0 | 100 | 5 | 30 |
| Price Weight | 0 | 100 | 5 | 20 |
| Risk Weight | 0 | 100 | 5 | 10 |

Leave "Add slicer to this page" ticked while the Supplier scorecard page is open. Each parameter
creates a small table of values (0, 5, 10 and so on) that is not related to anything else, plus a
measure such as `Delivery Weight Value` that reads the slider. `Supplier Score` uses those four
measures. The weights are relative: 40/30/20/10 gives the same score as 4/3/2/1.

## 8. Theme

*View > Themes > Browse for themes* and pick `powerbi/theme.json`. It sets the portfolio's colours:
stone page background, white cards, emerald as the first data colour, and soft red, amber and green
tints for conditional formatting. The portfolio uses Bodoni Moda and Inter Tight, but a Power BI
report only shows fonts installed on the viewer's computer, so the theme uses Segoe UI.

## 9. The four pages

Put slicers for `DimDate[Year]`, `DimPlant[PlantName]` and `DimMaterial[Category]` in a row at the
top of pages 1 to 3, and sync them across pages (*View > Sync slicers*).

### Page 1: Overview

- **KPI cards** in one row: `Total Spend`, `Spend YoY %`, `OTIF %`, `Average Lead Time`,
  `Reject Rate %`, `Price Variance %`. Spend YoY % only means something with one year selected, so
  add a card-level filter `DimDate[Year] = 2025` to that card, or tell readers to pick a year.
- **Spend by month:** clustered column chart, X axis `DimDate[YearMonth]`, Y axis `Total Spend`.
- **OTIF by month:** line chart, X axis `DimDate[YearMonth]`, Y axis `OTIF %`. Keep it as its own
  chart: spend is in euros and OTIF is a percentage, and putting both on one chart with two axes
  would suggest a link between them that the axis scales invent. Add a constant line only if a team
  has an agreed OTIF target; this data set has none.
- **Pareto of suppliers:** line and clustered column chart, X axis `DimSupplier[SupplierName]`,
  column values `Spend %`, line values `Cumulative Spend %`. Sort by `Spend %`, descending. Both
  series are percentages, so they share one axis. Show all 45 suppliers and let the chart scroll:
  a *Top N* filter on the visual would change what "total" means, because `ALLSELECTED` inside both
  measures respects the visual's own filters, and the line would reach 100% at the 15th supplier.

### Page 2: Supplier scorecard

- **The four weight sliders** from section 7, plus a card with `Weights Total`.
- **A table** with `DimSupplier[SupplierName]`, `DimSupplier[Category]`, `DimSupplier[Country]`,
  `Total Spend`, `OTIF %`, `Average Lead Time`, `Reject Rate %`, `Price Variance %`,
  `DimSupplier[Risk Points]`, `Supplier Score` and `Supplier Rank`, sorted by `Supplier Score`
  descending.
- **Conditional formatting:** on `Supplier Score`, *Cell elements > Background color > Gradient*,
  which picks up the theme's red, amber and green tints (lowest, middle, highest). On `Total Spend`
  add *Data bars*. Keep the text dark so it stays readable on every tint, and keep the numbers
  visible: colour alone should never be the only way to read a score.

Move the Delivery slider to 0 and back to see the ranking change. That is the point of the page:
the ranking depends on what the business values, and the sliders make that choice visible.

### Page 3: Risk

- **Cards:** `Single-Source Spend at Risk`, `Single-Source Spend %` and
  `Spend with Overdue Assessment`.
- **Risk matrix:** a matrix with `DimSupplier[CountryRiskTier]` on rows,
  `DimSupplier[DueDiligenceStatus]` on columns and `Total Spend` as values, with a background
  colour scale.
- **Single-source materials:** a table with `DimMaterial[MaterialName]`, `DimMaterial[Critical]`,
  `DimSupplier[SupplierName]`, `DimSupplier[CountryRiskTier]`, `DimSupplier[DueDiligenceStatus]`
  and `Total Spend`, with a visual filter `DimMaterial[SingleSource] = Yes`, sorted by spend.
- **Lead-time spike:** clustered column chart, X axis `DimDate[YearQuarter]`, Y axis
  `Average Lead Time`, with a visual filter `DimMaterial[Category] = Semiconductors`. Because the
  active relationship uses the order date, each column shows lines *ordered* in that quarter.

The country risk tiers in this data set are invented. They describe logistics exposure only (Low:
delivered by truck within Europe, Medium: transatlantic, High: Asian sea freight) and are not an
assessment of any country. The due-diligence status imitates the supplier risk assessments that
companies covered by the German Supply Chain Due Diligence Act (LkSG) track; this report makes no
legal statement about what the act requires.

### Page 4: Supplier detail (drill-through)

1. Add a new page and drag `DimSupplier[SupplierName]` into the **Drill through** well of the
   Visualizations pane. Power BI adds a back button.
2. Add cards for `Total Spend`, `OTIF %`, `Average Lead Time`, `Reject Rate %` and `Supplier Score`.
3. Add a line chart of `OTIF %` by `DimDate[YearQuarter]`.
4. Add a table of that supplier's late lines: `FactPOLine[PONumber]`, `DimMaterial[MaterialName]`,
   `FactPOLine[OrderDate]`, `FactPOLine[PromisedDate]`, `FactPOLine[LastReceiptDate]`, with visual
   filters `IsDue = True` and `OnTime = False`.
5. Add a multi-row card with `DimSupplier[Country]`, `DimSupplier[CountryRiskTier]`,
   `DimSupplier[DueDiligenceStatus]`, `DimSupplier[ISO9001]` and `DimSupplier[ISO14001]`.

To use it, right-click a supplier on the scorecard and choose *Drill through > Supplier detail*.

## 10. Save

Save the file as `powerbi/SupplierPerformance.pbix`. The data is simulated, so the file can be shared.

## 11. Check your build

These numbers come from `analysis/kpis.sql`, run in DuckDB on the same CSV files. If a card shows
something else, the difference points to the step to look at: totals that differ usually mean the
import locale (section 2); OTIF that differs usually means the IsDue, OnTime or InFull columns
(section 3.3); a YoY that differs usually means DimDate is not marked as the date table (section 4).

<!-- check:start -->
| What to check | How to see it in Power BI | It must show |
|---|---|---|
| Total Spend | Card, no filters | €209,049,522 (€209.05M) |
| Total Spend in 2024 and 2025 | Card, with a slicer on DimDate[Year] | €101,369,431 and €107,680,090 |
| Spend YoY % | Card, slicer on DimDate[Year] = 2025 | 6.2% |
| PO lines | Table with COUNTROWS(FactPOLine) | 5,958 |
| Lines due by the cut-off (2025-12-31) | [Due Lines] | 5,635 |
| OTIF % | Card, no filters | 79.2% |
| Average Lead Time | Card, no filters | 41.6 days |
| Lead Time Variability | Card, no filters | 32.7 days |
| Reject Rate % | Card, no filters | 0.90% |
| Price Variance % | Card, no filters | 0.47% |
| Single-Source Spend at Risk | Card, no filters | €35,695,301 (€35.70M) |
| Supplier S003 (Miraven Semiconductor Sdn. Bhd.) | Scorecard row, default weights 40/30/20/10 | spend €36.37M, OTIF 74.7%, score 77.4 |
| Supplier S001 (Vermar Semiconductor Co., Ltd.) | Scorecard row, default weights 40/30/20/10 | spend €25.71M, OTIF 68.9%, score 74.6 |
| Supplier S004 (Ostmar Semiconductor Co., Ltd.) | Scorecard row, default weights 40/30/20/10 | spend €17.07M, OTIF 70.6%, score 73.4 |
| Semiconductors ordered in 2025 Q2 | Average Lead Time, Category = Semiconductors, by YearQuarter | 145.5 days (earlier quarters 82 to 85) |
| OTIF of S028 (Taldex Connect Kft.) | OTIF % for that supplier, DimDate filtered to Jan to Jun 2024, then Jul to Dec 2025 | 80.4%, then 30.8% |
| OTIF of S014 (Ulmont Circuits s.r.o.) | OTIF % for that supplier, DimDate filtered to Jan to Jun 2024, then Jul to Dec 2025 | 90.2%, then 48.9% |
<!-- check:end -->

## 12. Interview questions about this model

**1. Why a star schema, and why only one fact table?**
A star schema keeps every filter path short and unambiguous: dimensions filter the fact, nothing
else. The data has two event tables, but every delivery KPI is a property of a PO line, so the
receipts are summed per line in Power Query and merged in. One fact table means no fact-to-fact
relationship and no ambiguous filter paths.

**2. Why single-direction relationships?**
Filters should flow from the descriptive tables into the facts, not back. Bidirectional filters
can make results depend on which visual filtered what, and they slow the model down. When a
measure needs the other direction, it can ask for it explicitly with `CROSSFILTER`.

**3. What does "Mark as date table" do?**
It tells Power BI which table is the calendar, so time intelligence functions such as
`SAMEPERIODLASTYEAR` work reliably. The table must have one row per day with no gaps, which is why
DimDate runs past the last order date to cover every promised date.

**4. How is OTIF defined here, and why only "due" lines?**
A line counts as OTIF if everything arrived on or before the promised date and at least the
ordered quantity arrived. Lines whose promised date is after the data cut-off cannot be judged yet,
so they are left out; due lines that have not arrived count as failures, otherwise late suppliers
would look better.

**5. When do you use a calculated column and when a measure?**
A column is calculated once per row and stored, which suits fixed attributes such as a supplier's
Risk Points. A measure is calculated for each filter context, which suits anything that should
change with the page filters, such as OTIF % or the weighted score.

**6. How do the weight sliders work?**
Each what-if parameter is a disconnected table of values made with `GENERATESERIES`, plus a measure
that reads the selected value with `SELECTEDVALUE` and falls back to a default. The score measure
multiplies each part by its weight and divides by the sum of the weights.

**7. Why can Spend YoY % look wrong on a card with no filters?**
`SAMEPERIODLASTYEAR` shifts whatever dates are in the filter by one year. With no filter, that is
the whole calendar against a calendar shifted back a year, which compares overlapping periods.
YoY needs a year, quarter or month on the axis or in a filter.

**8. How do you know the numbers are right?**
The same definitions are written a second time in SQL (`analysis/kpis.sql`) and run in DuckDB on
the same files. The report has to match that output to the euro and to one decimal of every
percentage. Row counts (PO lines, due lines) are the first thing to compare, because most errors
start with a wrong join or a wrong data type.
