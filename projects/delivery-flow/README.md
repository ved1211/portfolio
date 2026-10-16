# Where the work waits: Kanban flow metrics

> **Simulated data.** Built on simulated data, modelled on problems from my work in program
> delivery. The team, its 343 work items and every number in this folder are fictional. No data
> from SuperAGI or any other employer was used.

Live case study: https://ved1211.github.io/portfolio/projects/delivery-flow/

This project measures how work flows through a product team, finds the stage where work waits,
checks whether WIP limits helped, and forecasts delivery dates from the team's own throughput
instead of from estimates. The analysis is SQL running in DuckDB. Python only generates the
data, imports it and runs the SQL. The same pipeline runs on a real Jira export.

## What is in this folder

```
index.html, page.ts, board.ts,       the case study page (built by Vite with the rest of the site)
charts.ts, forecast.ts, types.ts
data/
  jira-export/issues.csv             simulated export in Jira's own format
  jira-export/status_changes.csv     one row per status change
  jira-export/flags.csv              blocked ("Flagged") periods
  items.csv                          clean tables written by import_jira.py
  status_history.csv
  blocked.csv
  flow.json                          everything the page draws, written by run_analysis.py
analysis/
  simulate.py                        the simulated team (fixed random seed)
  import_jira.py                     Jira export to clean tables
  sql/01_load.sql ... 11_board_replay.sql   the analysis, with plain-English comments
  run_analysis.py                    runs the SQL files in order and writes flow.json
  build.py                           runs all of the above for the simulated data
requirements.txt                     duckdb and numpy, pinned
```

## Run it

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r projects/delivery-flow/requirements.txt
cd projects/delivery-flow
../../.venv/bin/python analysis/build.py
```

`build.py` simulates the team, imports the simulated export, runs every SQL file and writes
`data/flow.json`. The random seed is fixed, so the output is the same on every run. The page
then needs nothing but the JSON: `npm run dev` from the repository root and open
`/portfolio/projects/delivery-flow/`.

## Run it on a real Jira export

1. **Issues.** In Jira, run a filter for the project and export it as CSV. These columns are used:

   | Column | Required | Used for |
   |---|---|---|
   | `Issue key` | yes | joins everything |
   | `Issue Type` | yes | Story, Bug, Tech Debt and so on |
   | `Priority` | yes | urgent work is drawn differently on the board |
   | `Created` | yes | when the item entered the Backlog |
   | `Summary` | no | kept for reference |
   | `Component/s` | no | used as the product stream |

2. **Status changes.** Jira's CSV export does not include status history, so it comes from each
   issue's changelog in the Jira REST API (`GET /rest/api/3/issue/{issueKey}/changelog`). Keep the
   entries whose `field` is `status` and save them as `status_changes.csv`:

   | Column | Meaning |
   |---|---|
   | `Issue key` | the issue |
   | `From Status` | the changelog item's `fromString` |
   | `To Status` | the changelog item's `toString` |
   | `Changed` | the changelog entry's `created` timestamp |

3. **Blocked periods (optional).** If the team uses Jira's "Flagged" field, keep changelog entries
   whose `field` is `Flagged` and save them as `flags.csv` with `Issue key`, `Flagged` (when the
   flag was set) and `Unflagged` (when it was cleared, blank if it is still set). A workflow with a
   "Blocked" status works too: map it to `Blocked` (see below) and it becomes a blocked period.

4. **Import and analyse.** Put the files in one folder and run:

   ```bash
   ../../.venv/bin/python analysis/import_jira.py --in my-export --out my-team
   ../../.venv/bin/python analysis/run_analysis.py --data my-team --out my-team/flow.json --change-date 2026-04-13
   ```

   `--change-date` is optional. It splits every result into before and after a change, such as
   introducing WIP limits. Dates are read in Jira's CSV format (`05/Jan/26 9:14 AM`) or ISO format.

### Mapping your workflow

The analysis uses six stages: Backlog, Ready, In Progress, Code Review, QA and Done. Common Jira
names are mapped already (for example `To Do` to Backlog, `In Review` to Code Review, `Testing`
to QA, `Closed` to Done). If the importer stops and lists statuses it does not know, map them in
a JSON file and pass it with `--status-map`:

```json
{ "Waiting for PO": "Ready", "Peer Review": "Code Review", "UAT": "QA", "Blocked by vendor": "Blocked" }
```

## How each metric is defined

| Metric | Definition | SQL file |
|---|---|---|
| Throughput | Items that reached Done in each 7-day week counted from the start date. | `03_throughput.sql` |
| Cycle time | Calendar days from first entering In Progress to reaching Done for good. | `02`, `04` |
| Percentiles | The 50th, 85th and 95th percentile of cycle time: the time that half, 85% and 95% of items beat. | `04_cycle_time.sql` |
| WIP | Items in In Progress, Code Review or QA at 23:59 each day. | `05_daily_board.sql` |
| Cumulative flow | The same daily counts for every stage; Done counts items finished since the start date. | `05_daily_board.sql` |
| Time in stage | Each finished item's cycle time split by stage, with blocked time taken out on its own. Averages, so the parts add up to the average cycle time. | `06_time_in_stage.sql` |
| Flow efficiency | Active time (In Progress and QA, not blocked) divided by cycle time. Jira cannot see whether anyone was working, so this is an upper bound. | `07_flow_efficiency.sql` |
| Blocked time | Overlap between flagged periods and each item's cycle. | `08_blocked.sql` |
| Item age | Days since an open item first entered In Progress, at the end of the data. | `09_aging.sql` |
| Little's Law | Average WIP compared with throughput per day multiplied by average cycle time, for the same window of days. | `10_littles_law.sql` |
| Forecast | 10,000 Monte Carlo runs in the browser, each sampling weekly throughput from the last 12 weeks until the requested number of items is reached. | `forecast.ts` |

"Before" and "after" group items by when they were **started**, so an item begun under the old
way of working counts as "before" even if it finished after the change.

## The simulated team

`simulate.py` is a simple day-by-day queue: work arrives, a product manager refills Ready on
Mondays and Thursdays, six developers build and review, and two testers run QA. The patterns are
deliberately plain:

- Code Review is the main place work waits, because developers prefer starting new work to
  reviewing someone else's.
- From week 6 to week 14 the team starts more than it finishes, so WIP creeps up.
- Urgent bugs (Bug with Highest priority) skip the queue at every stage.
- A few items are blocked for weeks or wait a long time in the review queue.
- From week 15 the team sets WIP limits (In Progress 5, Code Review 4, QA 3) and reviews before
  starting new work.

## Limitations

- The data is simulated. The patterns were built in on purpose, so the findings on the page show
  what the method can find, not facts about a real team.
- Flow efficiency treats In Progress and QA as working time. Real flow efficiency is lower.
- The forecast assumes the coming weeks look like the last 12 and that new items are about the
  same size as past ones.
