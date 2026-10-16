-- 11 · Item timelines for the board replay
-- Everything the page needs to redraw the board on any day: each item's
-- stage changes and blocked periods, as days since the start date.
-- Items finished before the start date are left out.

CREATE OR REPLACE TABLE board_items AS
SELECT c.key, c.type, c.stream, c.priority,
       round(epoch(c.created - s.start_date) / 86400, 3) AS created_day,
       (SELECT list([st.step, round(epoch(si.entered_at - s.start_date) / 86400, 3)] ORDER BY si.entered_at)
          FROM stage_intervals si JOIN stages st USING (stage)
         WHERE si.key = c.key)                                   AS moves,
       (SELECT list([round(epoch(b.blocked_start - s.start_date) / 86400, 3),
                     round(epoch(b.blocked_end - s.start_date) / 86400, 3)] ORDER BY b.blocked_start)
          FROM blocked b WHERE b.key = c.key)                    AS blocks
FROM item_cycle c, settings s
WHERE c.done_at IS NULL OR c.done_at >= s.start_date
ORDER BY c.key;
