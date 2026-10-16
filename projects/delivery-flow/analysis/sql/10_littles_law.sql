-- 10 · Little's Law check
-- Little's Law says that, over a stable stretch of time,
--     average WIP = throughput per day x average cycle time.
-- If the two sides are close, the data hangs together. If WIP is clearly
-- higher than the formula predicts, work is piling up faster than it leaves.
-- All three numbers use the same window of days, split at the change date.

CREATE OR REPLACE TABLE littles_law AS
WITH windows AS (
    SELECT 'before' AS window_name, start_date AS w_start, change_date - 1 AS w_end FROM settings WHERE change_date IS NOT NULL
    UNION ALL
    SELECT 'after', change_date, end_date FROM settings WHERE change_date IS NOT NULL
    UNION ALL
    SELECT 'all', start_date, end_date FROM settings
)
SELECT w.window_name,
       (w.w_end - w.w_start + 1)                                              AS days,
       (SELECT avg(b.wip) FROM daily_board b WHERE b.day BETWEEN w.w_start AND w.w_end)     AS avg_wip,
       (SELECT count(*) FROM finished_items f
         WHERE f.done_at >= w.w_start AND f.done_at < w.w_end + 1) / (w.w_end - w.w_start + 1) AS throughput_per_day,
       (SELECT avg(f.cycle_days) FROM finished_items f
         WHERE f.done_at >= w.w_start AND f.done_at < w.w_end + 1)            AS avg_cycle_days
FROM windows w;

CREATE OR REPLACE TABLE littles_law AS
SELECT *, throughput_per_day * avg_cycle_days AS predicted_wip
FROM littles_law;
