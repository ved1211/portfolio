-- 06 · Where the time goes
-- Splits every finished item's cycle time into the stages it passed through.
-- Blocked time (an item flagged as stuck, whatever stage it is in) is pulled
-- out into its own bucket, so the buckets add up exactly to cycle time.

CREATE OR REPLACE TABLE cycle_stage_time AS
SELECT si.key, si.stage,
       epoch(least(coalesce(si.left_at, f.done_at), f.done_at) - si.entered_at) / 86400 AS days,
       -- least() and greatest() skip NULLs in DuckDB, so rows with no block must be excluded explicitly
       coalesce(sum(epoch(least(b.blocked_end, coalesce(si.left_at, f.done_at), f.done_at)
                          - greatest(b.blocked_start, si.entered_at)) / 86400)
                FILTER (WHERE b.key IS NOT NULL), 0)                                    AS blocked_days
FROM stage_intervals si
JOIN finished_items f USING (key)
LEFT JOIN blocked b
       ON b.key = si.key
      AND b.blocked_start < least(coalesce(si.left_at, f.done_at), f.done_at)
      AND b.blocked_end > si.entered_at
WHERE si.entered_at >= f.started_at
  AND si.entered_at < f.done_at
GROUP BY si.key, si.stage, si.entered_at, si.left_at, f.done_at;

-- Per item, then averaged. Averages (not medians) are used here because
-- averages add up: the bars in the chart sum to the average cycle time.
CREATE OR REPLACE TABLE time_in_stage AS
WITH per_item AS (
    SELECT f.key, f.period, f.cycle_days,
           coalesce(sum(t.days - t.blocked_days) FILTER (WHERE t.stage = 'In Progress'), 0) AS in_progress,
           coalesce(sum(t.days - t.blocked_days) FILTER (WHERE t.stage = 'Code Review'), 0) AS code_review,
           coalesce(sum(t.days - t.blocked_days) FILTER (WHERE t.stage = 'QA'), 0)          AS qa,
           coalesce(sum(t.days - t.blocked_days) FILTER (WHERE t.stage NOT IN ('In Progress', 'Code Review', 'QA')), 0) AS other,
           coalesce(sum(t.blocked_days), 0)                                                  AS blocked
    FROM finished_items f
    LEFT JOIN cycle_stage_time t USING (key)
    GROUP BY ALL
)
SELECT coalesce(period, 'all') AS period,
       count(*)                AS items,
       avg(in_progress)        AS in_progress,
       avg(code_review)        AS code_review,
       avg(qa)                 AS qa,
       avg(blocked)            AS blocked,
       avg(other)              AS other,
       avg(cycle_days)         AS cycle_days
FROM per_item
GROUP BY GROUPING SETS ((period), ());
