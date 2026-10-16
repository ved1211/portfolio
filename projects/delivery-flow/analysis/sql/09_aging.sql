-- 09 · Age of open items
-- Work item age is how long an unfinished item has been in progress so far.
-- Comparing it with the cycle time percentiles shows which items are at risk:
-- an item older than the 85th percentile is already slower than 85% of the
-- items the team finished.

CREATE OR REPLACE TABLE open_item_age AS
SELECT c.key, c.type, c.priority, si.stage,
       epoch((s.end_date + INTERVAL 1 DAY) - c.started_at) / 86400 AS age_days
FROM item_cycle c
JOIN stage_intervals si ON si.key = c.key AND si.left_at IS NULL
CROSS JOIN settings s
WHERE si.stage IN ('In Progress', 'Code Review', 'QA')
ORDER BY age_days DESC, c.key;
