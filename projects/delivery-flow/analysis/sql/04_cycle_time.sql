-- 04 · Cycle time and its percentiles
-- Cycle time: calendar days from first entering In Progress to reaching Done.
-- A percentile says what share of items finished at or under a value: the
-- 85th percentile is the time that 85 out of every 100 items beat.
-- Only items that finished inside the date range are counted.

CREATE OR REPLACE TABLE finished_items AS
SELECT c.*
FROM item_cycle c, settings s
WHERE c.done_at >= s.start_date AND c.done_at < s.end_date + 1;

CREATE OR REPLACE TABLE cycle_time_percentiles AS
SELECT coalesce(period, 'all')            AS period,
       count(*)                           AS items,
       quantile_cont(cycle_days, 0.50)    AS p50,
       quantile_cont(cycle_days, 0.85)    AS p85,
       quantile_cont(cycle_days, 0.95)    AS p95,
       avg(cycle_days)                    AS mean_days
FROM finished_items
GROUP BY GROUPING SETS ((period), ());
