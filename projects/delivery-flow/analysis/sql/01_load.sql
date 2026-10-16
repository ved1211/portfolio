-- 01 · Load the data
-- Reads the three clean tables that import_jira.py writes. The same files come
-- out of the simulator and out of a real Jira export, so nothing below needs
-- to know which one it is looking at.
-- Timestamps are local clock time with no time zone.
-- __DATA_DIR__ is filled in by run_analysis.py.

CREATE OR REPLACE TABLE items AS
SELECT * FROM read_csv('__DATA_DIR__/items.csv', header = true, columns = {
    'key': 'VARCHAR', 'type': 'VARCHAR', 'stream': 'VARCHAR',
    'priority': 'VARCHAR', 'summary': 'VARCHAR', 'created': 'TIMESTAMP'});

CREATE OR REPLACE TABLE status_history AS
SELECT * FROM read_csv('__DATA_DIR__/status_history.csv', header = true, columns = {
    'key': 'VARCHAR', 'from_status': 'VARCHAR', 'to_status': 'VARCHAR', 'changed_at': 'TIMESTAMP'});

-- A blocked period with no end is still blocked when the data stops.
CREATE OR REPLACE TABLE blocked AS
SELECT b.key, b.blocked_start, coalesce(b.blocked_end, s.end_date + INTERVAL 1 DAY) AS blocked_end
FROM read_csv('__DATA_DIR__/blocked.csv', header = true, columns = {
         'key': 'VARCHAR', 'blocked_start': 'TIMESTAMP', 'blocked_end': 'TIMESTAMP'}) b,
     settings s;

-- The six stages in board order, and what kind of time each one is.
-- Jira cannot tell us whether anyone was actually working, so this is an
-- assumption: In Progress and QA count as active work, Code Review counts as
-- waiting (most review time is spent in a queue, not reading code).
CREATE OR REPLACE TABLE stages (stage VARCHAR, step INTEGER, kind VARCHAR);
INSERT INTO stages VALUES
    ('Backlog', 0, 'not started'),
    ('Ready', 1, 'not started'),
    ('In Progress', 2, 'active'),
    ('Code Review', 3, 'waiting'),
    ('QA', 4, 'active'),
    ('Done', 5, 'finished');
