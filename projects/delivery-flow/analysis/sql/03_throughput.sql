-- 03 · Weekly throughput
-- Throughput is the number of items a team finishes in a period of time.
-- Week 1 is the first seven days from the start date.

CREATE OR REPLACE TABLE weeks AS
SELECT CAST(w AS INTEGER) AS week, s.start_date + CAST((w - 1) * 7 AS INTEGER) AS week_start
FROM settings s, range(1, CAST(floor((s.end_date - s.start_date + 1) / 7) AS INTEGER) + 1) t(w);

CREATE OR REPLACE TABLE weekly_throughput AS
SELECT w.week, w.week_start, count(c.key) AS finished
FROM weeks w
LEFT JOIN item_cycle c
       ON c.done_at >= w.week_start AND c.done_at < w.week_start + 7
GROUP BY ALL
ORDER BY w.week;
