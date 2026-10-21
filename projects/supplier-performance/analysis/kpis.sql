-- Supplier performance KPIs, in SQL (DuckDB)
-- SIMULATED DATA: a fictional ECU manufacturer, not any real company.
--
-- These are the same numbers the Power BI report shows, computed a second way
-- so the report can be checked. Every definition below matches a measure in
-- powerbi/measures.dax. To run it by hand in the DuckDB command line, replace
-- __DATA_DIR__ with the path to the data folder, then:  .read analysis/kpis.sql
-- run_kpis.py does that for you and writes data/kpis.json.


-- ── 1. Load the star schema ──────────────────────────────────────────────

CREATE OR REPLACE TABLE dim_supplier AS
SELECT * FROM read_csv('__DATA_DIR__/DimSupplier.csv', header = true, columns = {
    'SupplierID': 'VARCHAR', 'SupplierName': 'VARCHAR', 'Country': 'VARCHAR', 'CountryCode': 'VARCHAR',
    'Category': 'VARCHAR', 'ISO9001': 'VARCHAR', 'ISO14001': 'VARCHAR', 'SingleSource': 'VARCHAR',
    'CountryRiskTier': 'VARCHAR', 'DueDiligenceStatus': 'VARCHAR', 'LastAssessmentDate': 'DATE'});

CREATE OR REPLACE TABLE dim_material AS
SELECT * FROM read_csv('__DATA_DIR__/DimMaterial.csv', header = true, columns = {
    'MaterialID': 'VARCHAR', 'MaterialName': 'VARCHAR', 'Category': 'VARCHAR', 'Critical': 'VARCHAR',
    'SingleSource': 'VARCHAR', 'ApprovedSuppliers': 'INTEGER', 'StandardPriceEUR': 'DOUBLE'});

CREATE OR REPLACE TABLE fact_po_line_raw AS
SELECT * FROM read_csv('__DATA_DIR__/FactPOLine.csv', header = true, columns = {
    'POLineID': 'VARCHAR', 'PONumber': 'VARCHAR', 'OrderDate': 'DATE', 'PromisedDate': 'DATE',
    'SupplierID': 'VARCHAR', 'MaterialID': 'VARCHAR', 'PlantID': 'VARCHAR', 'OrderedQty': 'BIGINT',
    'StandardUnitPriceEUR': 'DOUBLE', 'PaidUnitPriceEUR': 'DOUBLE', 'NetValueEUR': 'DOUBLE', 'StandardValueEUR': 'DOUBLE'});

CREATE OR REPLACE TABLE fact_goods_receipt AS
SELECT * FROM read_csv('__DATA_DIR__/FactGoodsReceipt.csv', header = true, columns = {
    'ReceiptID': 'VARCHAR', 'POLineID': 'VARCHAR', 'ReceiptDate': 'DATE', 'ReceivedQty': 'BIGINT', 'RejectedQty': 'BIGINT'});


-- ── 2. One row per PO line, the same merge the Power Query steps make ────
-- A PO line can arrive in more than one goods receipt. On-time and in-full
-- are judged per PO line, so the receipts are summed up per line first:
-- the last receipt date, the total received and the total rejected.

CREATE OR REPLACE VIEW receipt_summary AS
SELECT POLineID,
       max(ReceiptDate)  AS LastReceiptDate,
       sum(ReceivedQty)  AS ReceivedQty,
       sum(RejectedQty)  AS RejectedQty,
       count(*)          AS Receipts
FROM fact_goods_receipt
GROUP BY POLineID;

-- The data cut-off is the last day anything was received. A line only counts
-- for OTIF once its promised date has passed by then.
CREATE OR REPLACE VIEW cutoff AS
SELECT max(ReceiptDate) AS cutoff_date FROM fact_goods_receipt;

CREATE OR REPLACE VIEW po_line AS
SELECT p.*,
       r.LastReceiptDate,
       r.ReceivedQty,
       r.RejectedQty,
       coalesce(r.Receipts, 0)                                   AS Receipts,
       date_diff('day', p.OrderDate, r.LastReceiptDate)          AS LeadTimeDays,
       p.PromisedDate <= c.cutoff_date                           AS IsDue,
       coalesce(r.LastReceiptDate <= p.PromisedDate, false)      AS OnTime,
       coalesce(r.ReceivedQty >= p.OrderedQty, false)            AS InFull
FROM fact_po_line_raw p
LEFT JOIN receipt_summary r USING (POLineID)
CROSS JOIN cutoff c;


-- ── 3. The headline numbers ──────────────────────────────────────────────
-- Spend:            ordered quantity x price paid, counted on the order date.
-- OTIF:             share of due PO lines that arrived on or before the promised
--                   date AND in the full ordered quantity. Due lines that have
--                   not arrived count as failures.
-- Lead time:        days from order date to the last receipt, for lines that arrived.
-- Variability:      population standard deviation of that lead time (STDEV.P in DAX).
-- Reject rate:      units rejected at incoming inspection / units received.
-- Price variance:   (spend at price paid - spend at standard price) / spend at standard price.
-- Single-source:    spend on materials that only one approved supplier can deliver.

CREATE OR REPLACE VIEW kpi_overall AS
SELECT
    sum(NetValueEUR)                                                                AS total_spend,
    sum(NetValueEUR) FILTER (WHERE year(OrderDate) = 2024)                          AS spend_2024,
    sum(NetValueEUR) FILTER (WHERE year(OrderDate) = 2025)                          AS spend_2025,
    (sum(NetValueEUR) FILTER (WHERE year(OrderDate) = 2025)
       - sum(NetValueEUR) FILTER (WHERE year(OrderDate) = 2024))
       / sum(NetValueEUR) FILTER (WHERE year(OrderDate) = 2024)                     AS spend_yoy_2025,
    count(*)                                                                        AS po_lines,
    count(*) FILTER (WHERE IsDue)                                                   AS due_lines,
    count(*) FILTER (WHERE IsDue AND OnTime AND InFull) / count(*) FILTER (WHERE IsDue) AS otif,
    avg(LeadTimeDays)                                                               AS avg_lead_time_days,
    stddev_pop(LeadTimeDays)                                                        AS lead_time_stdev_days,
    sum(RejectedQty) / sum(ReceivedQty)                                             AS reject_rate,
    (sum(NetValueEUR) - sum(StandardValueEUR)) / sum(StandardValueEUR)              AS price_variance,
    (SELECT sum(p.NetValueEUR) FROM fact_po_line_raw p JOIN dim_material m USING (MaterialID)
      WHERE m.SingleSource = 'Yes')                                                 AS single_source_spend,
    (SELECT cutoff_date FROM cutoff)                                                AS cutoff_date
FROM po_line;


-- ── 4. Per supplier, with the weighted score ─────────────────────────────
-- Each part of the score runs from 0 (worst) to 100 (best):
--   Delivery = OTIF x 100
--   Quality  = 100 x (1 - reject rate / 2%), never below 0
--   Price    = 100 x (1 - price variance / 10%), kept between 0 and 100
--   Risk     = tier points (Low 100, Medium 70, High 40) plus a due-diligence
--              penalty (Open -15, Overdue -40), never below 0
-- The score is the weighted average of the four parts. The default weights
-- (40, 30, 20, 10) are the same defaults as the what-if sliders in Power BI.

CREATE OR REPLACE VIEW kpi_supplier AS
WITH per AS (
    SELECT l.SupplierID,
           sum(l.NetValueEUR)                                                    AS spend,
           count(*) FILTER (WHERE l.IsDue)                                       AS due_lines,
           count(*) FILTER (WHERE l.IsDue AND l.OnTime AND l.InFull)
             / nullif(count(*) FILTER (WHERE l.IsDue), 0)                        AS otif,
           avg(l.LeadTimeDays)                                                   AS avg_lead_time_days,
           stddev_pop(l.LeadTimeDays)                                            AS lead_time_stdev_days,
           sum(l.RejectedQty) / nullif(sum(l.ReceivedQty), 0)                    AS reject_rate,
           (sum(l.NetValueEUR) - sum(l.StandardValueEUR)) / sum(l.StandardValueEUR) AS price_variance
    FROM po_line l
    GROUP BY l.SupplierID
),
scored AS (
    SELECT s.SupplierID, s.SupplierName, s.Country, s.Category, s.CountryRiskTier, s.DueDiligenceStatus,
           s.SingleSource, s.ISO9001, s.ISO14001, per.*  EXCLUDE (SupplierID),
           per.spend / sum(per.spend) OVER ()                                    AS spend_share,
           per.otif * 100                                                        AS delivery_score,
           100 * greatest(0, 1 - per.reject_rate / 0.02)                         AS quality_score,
           100 * least(1, greatest(0, 1 - per.price_variance / 0.10))            AS price_score,
           greatest(0, CASE s.CountryRiskTier WHEN 'Low' THEN 100 WHEN 'Medium' THEN 70 ELSE 40 END
                     + CASE s.DueDiligenceStatus WHEN 'Open' THEN -15 WHEN 'Overdue' THEN -40 ELSE 0 END) AS risk_score
    FROM dim_supplier s
    JOIN per USING (SupplierID)
)
SELECT *,
       (40 * delivery_score + 30 * quality_score + 20 * price_score + 10 * risk_score) / 100 AS supplier_score,
       row_number() OVER (ORDER BY spend DESC, SupplierID)                                    AS spend_rank
FROM scored;


-- ── 5. Views behind the report pages ─────────────────────────────────────

-- Pareto: suppliers from largest to smallest spend, with the running share.
CREATE OR REPLACE VIEW kpi_pareto AS
SELECT spend_rank, SupplierID, SupplierName, spend,
       sum(spend) OVER (ORDER BY spend_rank) / sum(spend) OVER () AS cumulative_share
FROM kpi_supplier
ORDER BY spend_rank;

-- Spend and OTIF by order month.
CREATE OR REPLACE VIEW kpi_monthly AS
SELECT strftime(date_trunc('month', OrderDate), '%Y-%m')                  AS month,
       sum(NetValueEUR)                                                    AS spend,
       count(*) FILTER (WHERE IsDue AND OnTime AND InFull)
         / nullif(count(*) FILTER (WHERE IsDue), 0)                        AS otif,
       count(*) FILTER (WHERE IsDue)                                       AS due_lines
FROM po_line
GROUP BY 1
ORDER BY 1;

-- OTIF by order quarter for every supplier, used to spot the ones getting worse.
CREATE OR REPLACE VIEW kpi_supplier_quarter AS
SELECT SupplierID,
       year(OrderDate) || ' Q' || quarter(OrderDate)                       AS quarter,
       count(*) FILTER (WHERE IsDue AND OnTime AND InFull)
         / nullif(count(*) FILTER (WHERE IsDue), 0)                        AS otif,
       count(*) FILTER (WHERE IsDue)                                       AS due_lines
FROM po_line
GROUP BY ALL
ORDER BY SupplierID, quarter;

-- The two suppliers whose OTIF fell most from the first half of 2024 to the
-- second half of 2025 (suppliers with at least 15 due lines in both halves).
CREATE OR REPLACE VIEW kpi_worsening AS
WITH halves AS (
    SELECT SupplierID,
           count(*) FILTER (WHERE IsDue AND OnTime AND InFull AND OrderDate < DATE '2024-07-01')
             / nullif(count(*) FILTER (WHERE IsDue AND OrderDate < DATE '2024-07-01'), 0)  AS otif_first,
           count(*) FILTER (WHERE IsDue AND OnTime AND InFull AND OrderDate >= DATE '2025-07-01')
             / nullif(count(*) FILTER (WHERE IsDue AND OrderDate >= DATE '2025-07-01'), 0) AS otif_last,
           least(count(*) FILTER (WHERE IsDue AND OrderDate < DATE '2024-07-01'),
                 count(*) FILTER (WHERE IsDue AND OrderDate >= DATE '2025-07-01'))         AS min_lines
    FROM po_line
    GROUP BY SupplierID
)
SELECT h.SupplierID, s.SupplierName, s.Category, s.Country, h.otif_first, h.otif_last,
       h.otif_last - h.otif_first AS change
FROM halves h JOIN dim_supplier s USING (SupplierID)
WHERE h.min_lines >= 15
ORDER BY change, h.SupplierID
LIMIT 2;

-- Semiconductor lead times by order quarter: the 2025 Q2 jump.
CREATE OR REPLACE VIEW kpi_semis_lead_time AS
SELECT year(l.OrderDate) || ' Q' || quarter(l.OrderDate)                   AS quarter,
       avg(l.LeadTimeDays)                                                 AS avg_lead_time_days,
       avg(date_diff('day', l.OrderDate, l.PromisedDate))                  AS avg_promised_days,
       (sum(l.NetValueEUR) - sum(l.StandardValueEUR)) / sum(l.StandardValueEUR) AS price_variance,
       count(l.LeadTimeDays)                                               AS delivered_lines
FROM po_line l JOIN dim_material m USING (MaterialID)
WHERE m.Category = 'Semiconductors'
GROUP BY 1
ORDER BY 1;

-- Spend by country risk tier and due-diligence status.
CREATE OR REPLACE VIEW kpi_risk_matrix AS
SELECT s.CountryRiskTier, s.DueDiligenceStatus, count(DISTINCT s.SupplierID) AS suppliers, sum(l.NetValueEUR) AS spend
FROM po_line l JOIN dim_supplier s USING (SupplierID)
GROUP BY ALL
ORDER BY 1, 2;

-- Single-source materials, largest spend first.
CREATE OR REPLACE VIEW kpi_single_source AS
SELECT m.MaterialID, m.MaterialName, m.Category, m.Critical, s.SupplierID, s.SupplierName,
       s.CountryRiskTier, s.DueDiligenceStatus, sum(l.NetValueEUR) AS spend
FROM po_line l
JOIN dim_material m USING (MaterialID)
JOIN dim_supplier s USING (SupplierID)
WHERE m.SingleSource = 'Yes'
GROUP BY ALL
ORDER BY spend DESC, m.MaterialID;

-- Spend by material category.
CREATE OR REPLACE VIEW kpi_category AS
SELECT m.Category, sum(l.NetValueEUR) AS spend, count(DISTINCT l.SupplierID) AS suppliers
FROM po_line l JOIN dim_material m USING (MaterialID)
GROUP BY 1
ORDER BY spend DESC, 1;
