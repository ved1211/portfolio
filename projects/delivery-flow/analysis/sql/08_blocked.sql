-- 08 · Blocked time
-- How often finished items were blocked, and how much of their cycle time
-- that cost.

CREATE OR REPLACE TABLE blocked_summary AS
WITH per_item AS (
    SELECT f.key, f.period, f.cycle_days, coalesce(sum(t.blocked_days), 0) AS blocked_days
    FROM finished_items f LEFT JOIN cycle_stage_time t USING (key)
    GROUP BY ALL
)
SELECT coalesce(period, 'all')                          AS period,
       count(*)                                         AS items,
       count(*) FILTER (WHERE blocked_days > 0)         AS items_blocked,
       sum(blocked_days)                                AS blocked_days,
       sum(blocked_days) / sum(cycle_days)              AS share_of_cycle_time,
       max(blocked_days)                                AS longest_block_days
FROM per_item
GROUP BY GROUPING SETS ((period), ());
