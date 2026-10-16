-- 07 · Flow efficiency
-- Flow efficiency is the share of an item's cycle time in which someone was
-- actually working on it: active time divided by total time.
-- Active = In Progress + QA, minus any blocked time (see 01_load.sql for why).
-- Waiting = Code Review + blocked time.
-- It is computed over all items together (total active days divided by
-- total cycle days), so long items weigh more than short ones.

CREATE OR REPLACE TABLE flow_efficiency AS
SELECT period,
       items,
       (in_progress + qa) / cycle_days                AS efficiency,
       (code_review + blocked + other) / cycle_days   AS waiting_share
FROM time_in_stage;
