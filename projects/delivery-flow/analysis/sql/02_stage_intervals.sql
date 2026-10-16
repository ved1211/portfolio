-- 02 · How long each item sat in each stage
-- An item enters a stage at a status change and leaves it at the next change.
-- Its first stage (usually Backlog) starts at the moment it was created.

CREATE OR REPLACE TABLE stage_intervals AS
WITH first_stage AS (
    -- the stage an item was in before its first recorded change
    SELECT key, arg_min(from_status, changed_at) AS stage
    FROM status_history
    GROUP BY key
),
entries AS (
    SELECT i.key, coalesce(f.stage, 'Backlog') AS stage, i.created AS entered_at
    FROM items i LEFT JOIN first_stage f USING (key)
    UNION ALL
    SELECT key, to_status, changed_at
    FROM status_history
)
SELECT key, stage, entered_at,
       lead(entered_at) OVER (PARTITION BY key ORDER BY entered_at) AS left_at
FROM entries;

-- One row per item with the two moments that matter:
--   started_at  the first time it entered In Progress
--   done_at     the time it reached Done for good (NULL if it is still open)
-- Cycle time is the gap between them, in calendar days.
-- "period" says whether the item was started before or after the team set
-- WIP limits, so items that began under the old way of working are judged
-- as part of the old way even if they finished later.
CREATE OR REPLACE TABLE item_cycle AS
WITH marks AS (
    SELECT i.key, i.type, i.stream, i.priority, i.created,
           min(s.entered_at) FILTER (WHERE s.stage = 'In Progress') AS started_at,
           max(s.entered_at) FILTER (WHERE s.stage = 'Done' AND s.left_at IS NULL) AS done_at
    FROM items i LEFT JOIN stage_intervals s USING (key)
    GROUP BY ALL
)
SELECT m.*,
       epoch(m.done_at - m.started_at) / 86400 AS cycle_days,
       CASE WHEN m.started_at IS NULL THEN NULL
            WHEN st.change_date IS NULL THEN 'all'
            WHEN m.started_at < st.change_date THEN 'before'
            ELSE 'after' END AS period
FROM marks m, settings st;
