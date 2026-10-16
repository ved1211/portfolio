-- 05 · The board at the end of every day
-- Counts how many items sat in each stage at 23:59 each day. This one table
-- feeds the cumulative flow diagram and the WIP chart.
-- WIP (work in progress) is everything started but not finished:
-- In Progress + Code Review + QA.

CREATE OR REPLACE TABLE days AS
SELECT CAST(d AS DATE) AS day
FROM settings s, range(s.start_date, s.end_date + 1, INTERVAL 1 DAY) t(d);

CREATE OR REPLACE TABLE daily_stage_counts AS
SELECT d.day, si.stage, count(*) AS items
FROM days d
JOIN stage_intervals si
  ON si.entered_at < d.day + INTERVAL 1 DAY
 AND (si.left_at IS NULL OR si.left_at >= d.day + INTERVAL 1 DAY)
GROUP BY ALL;

-- One row per day, one column per stage. Done counts only items finished
-- since the start date, so the cumulative flow diagram starts from zero.
CREATE OR REPLACE TABLE daily_board AS
WITH wide AS (
    SELECT d.day,
           coalesce(sum(items) FILTER (WHERE stage = 'Backlog'), 0)     AS backlog,
           coalesce(sum(items) FILTER (WHERE stage = 'Ready'), 0)       AS ready,
           coalesce(sum(items) FILTER (WHERE stage = 'In Progress'), 0) AS in_progress,
           coalesce(sum(items) FILTER (WHERE stage = 'Code Review'), 0) AS code_review,
           coalesce(sum(items) FILTER (WHERE stage = 'QA'), 0)          AS qa
    FROM days d LEFT JOIN daily_stage_counts c USING (day)
    GROUP BY d.day
)
SELECT w.*,
       w.in_progress + w.code_review + w.qa AS wip,
       (SELECT count(*) FROM finished_items f WHERE f.done_at < w.day + INTERVAL 1 DAY) AS done
FROM wide w
ORDER BY w.day;
