"""
Simulate 26 weeks of Jira data for a fictional product team.

SIMULATED DATA. Nothing here comes from a real team or employer. The model is
a simple day-by-day queue: work arrives, a product manager refills the Ready
column twice a week, six developers build and review, two testers run QA.
The patterns built in are deliberately plain, not dramatic:

  * Code Review is the main place work waits, because developers prefer
    starting new work to reviewing someone else's.
  * From week 6 to week 14 the team starts more than it finishes, so work in
    progress (WIP) creeps up and everything slows down.
  * Urgent bugs skip the queue at every stage.
  * A few items get blocked for weeks or starve in the review queue.
  * From week 15 the team sets WIP limits (In Progress 5, Code Review 4,
    QA 3), reviews before starting new work, and cycle times tighten.

The output is shaped like a Jira export, so it goes through the same
importer (import_jira.py) that a real export would:

  data/jira-export/issues.csv          Issue key, Issue Type, Summary, Component/s, Priority, Created, Status, Resolved
  data/jira-export/status_changes.csv  Issue key, From Status, To Status, Changed
  data/jira-export/flags.csv           Issue key, Flagged, Unflagged

Run:  python analysis/simulate.py   (from projects/delivery-flow)
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path

import numpy as np

SEED = 20260105
START = date(2026, 1, 5)          # Monday of week 1
WEEKS = 26
WARMUP_DAYS = 21                  # the team was already working before week 1
LIMITS_FROM_WEEK = 15
WIP_LIMITS = {"In Progress": 5, "Code Review": 4, "QA": 3}
DEVELOPERS, TESTERS = 6, 2        # plus one product manager: a 9-person team

STREAMS = (["Payments", "Onboarding", "Reporting"], [0.40, 0.35, 0.25])
TYPES = (["Story", "Bug", "Tech Debt"], [0.58, 0.30, 0.12])
PRIORITIES = {
    "Story": (["High", "Medium", "Low"], [0.25, 0.60, 0.15]),
    "Bug": (["Highest", "High", "Medium", "Low"], [0.16, 0.30, 0.44, 0.10]),
    "Tech Debt": (["High", "Medium", "Low"], [0.10, 0.50, 0.40]),
}
PRIORITY_RANK = {"Highest": 0, "High": 1, "Medium": 2, "Low": 3}
# Developer effort in working days: lognormal(median, sigma)
DEV_EFFORT = {"Story": (2.0, 0.6), "Bug": (0.8, 0.7), "Tech Debt": (1.6, 0.6)}
REVIEW_EFFORT = {"Story": 0.32, "Bug": 0.2, "Tech Debt": 0.28}
QA_EFFORT = {"Story": (0.7, 0.5), "Bug": (0.45, 0.5), "Tech Debt": (0.4, 0.5)}

SUMMARIES = {
    "Payments": ["Retry failed card payments", "Show VAT on invoices", "Add SEPA direct debit",
                 "Refund flow for partial orders", "Payment receipt email", "Currency rounding rules",
                 "Saved cards for returning customers", "3-D Secure challenge screen"],
    "Onboarding": ["Shorter sign-up form", "Invite teammates by link", "Welcome checklist",
                   "Email verification reminder", "Company profile step", "Single sign-on option",
                   "Sample data for new accounts", "Progress bar on setup"],
    "Reporting": ["Export report as CSV", "Monthly summary email", "Filter dashboard by team",
                  "Scheduled report delivery", "Chart for weekly usage", "Date range picker",
                  "Share report with a link", "Totals row in tables"],
}
BUG_PREFIX = ["Fix", "Crash in", "Wrong total in", "Timeout on", "Broken layout in"]
DEBT_PREFIX = ["Upgrade library for", "Refactor", "Remove dead code in", "Add tests for"]


@dataclass
class Item:
    key: str
    type: str
    stream: str
    priority: str
    summary: str
    created: datetime
    status: str = "Backlog"
    dev_left: float = 0.0
    review_left: float = 0.0
    qa_left: float = 0.0
    changes: list = field(default_factory=list)      # (from, to, datetime)
    blocks: list = field(default_factory=list)       # [start, end or None]
    blocked_until: int | None = None                 # day index the block lifts
    review_bounced: bool = False
    qa_bounced: bool = False
    entered_day: int = 0
    last_ts: datetime | None = None

    @property
    def urgent(self) -> bool:
        return self.type == "Bug" and self.priority == "Highest"


class Sim:
    def __init__(self) -> None:
        self.rng = np.random.default_rng(SEED)
        self.items: list[Item] = []
        self.next_key = 101

    # ── helpers ────────────────────────────────────────────────────────────
    def pick(self, options, weights):
        return options[self.rng.choice(len(options), p=weights)]

    def lognormal(self, median: float, sigma: float) -> float:
        return float(median * np.exp(self.rng.normal(0, sigma)))

    def day_date(self, d: int) -> date:
        return START + timedelta(days=d)

    def week(self, d: int) -> int:
        return max(1, d // 7 + 1)

    def limits_on(self, d: int) -> bool:
        return self.week(d) >= LIMITS_FROM_WEEK

    def stamp(self, it: Item, d: int, lo: float, hi: float) -> datetime:
        """A time inside working hours on day d, always after the item's last change."""
        hour = float(self.rng.uniform(lo, hi))
        ts = datetime.combine(self.day_date(d), time(0)) + timedelta(hours=hour)
        ts = ts.replace(second=0, microsecond=0)
        if it.last_ts and ts <= it.last_ts:
            ts = it.last_ts + timedelta(minutes=int(self.rng.integers(4, 25)))
        it.last_ts = ts
        return ts

    def move(self, it: Item, to: str, d: int, lo: float, hi: float) -> None:
        ts = self.stamp(it, d, lo, hi)
        it.changes.append((it.status, to, ts))
        it.status = to
        it.entered_day = d

    def in_status(self, status: str) -> list[Item]:
        return [i for i in self.items if i.status == status]

    @staticmethod
    def by_priority(items: list[Item]) -> list[Item]:
        return sorted(items, key=lambda i: (PRIORITY_RANK[i.priority], i.entered_day, i.created))

    # ── the team's behaviour ───────────────────────────────────────────────
    def new_item(self, d: int) -> Item:
        typ = self.pick(*TYPES)
        stream = self.pick(*STREAMS)
        prio = self.pick(*PRIORITIES[typ])
        base = self.pick(SUMMARIES[stream], [1 / len(SUMMARIES[stream])] * len(SUMMARIES[stream]))
        if typ == "Bug":
            summary = f"{self.pick(BUG_PREFIX, [0.2] * 5)} {base.lower()}"
        elif typ == "Tech Debt":
            summary = f"{self.pick(DEBT_PREFIX, [0.25] * 4)} {base.lower()}"
        else:
            summary = base
        it = Item(f"FLW-{self.next_key}", typ, stream, prio, summary, datetime.min)
        self.next_key += 1
        it.created = self.stamp(it, d, 8.5, 17.5)
        it.entered_day = d
        effort, sigma = DEV_EFFORT[typ]
        it.dev_left = self.lognormal(0.6 if it.urgent else effort, sigma)
        it.review_left = REVIEW_EFFORT[typ]
        it.qa_left = self.lognormal(*QA_EFFORT[typ])
        self.items.append(it)
        return it

    def review_share(self, d: int) -> float:
        """Share of developer time spent reviewing. It falls during the WIP creep."""
        w = self.week(d)
        if self.limits_on(d):
            return 0.28 if len(self.in_status("Code Review")) >= 3 else 0.18
        if w <= 5:
            return 0.12
        return 0.12 - 0.025 * min(1.0, (w - 5) / 9)

    def start_threshold(self, d: int) -> float:
        """How many unblocked items developers are happy to juggle before limits."""
        w = self.week(d)
        if w <= 5:
            return 7.0
        return 7.0 + 0.45 * min(w - 5, 9)

    def run(self) -> None:
        first = -WARMUP_DAYS
        last = WEEKS * 7 - 1
        # A backlog that existed before the simulation starts
        for _ in range(40):
            self.new_item(first - int(self.rng.integers(1, 40)))
        long_blocks = set(int(x) for x in self.rng.choice(np.arange(150, 420), size=5, replace=False))

        for d in range(first, last + 1):
            if self.day_date(d).weekday() >= 5:
                continue  # nobody works at weekends
            limits = self.limits_on(d)

            # 1. New work arrives. Urgent bugs go straight to the front of Ready.
            for _ in range(int(self.rng.poisson(2.0))):
                it = self.new_item(d)
                if it.urgent:
                    self.move(it, "Ready", d, 9, 17.5)

            # 2. The product manager refills Ready on Mondays and Thursdays.
            if self.day_date(d).weekday() in (0, 3):
                target = 10 if limits else 12
                backlog = self.by_priority(self.in_status("Backlog"))
                need = target - len(self.in_status("Ready"))
                for it in backlog[:max(0, need)]:
                    self.move(it, "Ready", d, 9.5, 10.5)

            # 3. Blocks that end today are lifted.
            for it in self.items:
                if it.blocked_until is not None and it.blocked_until <= d:
                    it.blocks[-1][1] = self.stamp(it, d, 9, 12)
                    it.blocked_until = None

            # The team walks the board from right to left: finish, then review,
            # then build, and only then start something new.

            # 4. QA. Two testers, urgent first. Only items that arrived before today.
            qa_cap = TESTERS * 1.0
            for it in self.by_priority([i for i in self.in_status("QA") if i.entered_day < d and i.blocked_until is None]):
                if qa_cap <= 0:
                    break
                spend = min(qa_cap, it.qa_left)
                it.qa_left -= spend
                qa_cap -= spend
                if it.qa_left > 1e-9:
                    continue
                if not it.qa_bounced and self.rng.random() < 0.07:
                    it.qa_bounced = True
                    it.dev_left = self.lognormal(0.5, 0.5)
                    it.review_left = REVIEW_EFFORT[it.type] * 0.5
                    it.qa_left = self.lognormal(0.3, 0.4)
                    self.move(it, "In Progress", d, 9, 12)
                    continue
                self.move(it, "Done", d, 9, 12.5)

            # 5. Code review. Only items that arrived before today, urgent first.
            review_cap = DEVELOPERS * self.review_share(d)
            queue = self.by_priority([i for i in self.in_status("Code Review")
                                      if i.entered_day < d and i.blocked_until is None])
            for it in queue:
                if review_cap <= 0:
                    break
                if it.review_left > 0:
                    spend = min(review_cap, it.review_left)
                    it.review_left -= spend
                    review_cap -= spend
                if it.review_left > 1e-9:
                    continue
                if not it.review_bounced and self.rng.random() < 0.12:
                    it.review_bounced = True
                    it.dev_left = self.lognormal(0.35, 0.5)
                    it.review_left = REVIEW_EFFORT[it.type] * 0.6
                    self.move(it, "In Progress", d, 10, 14)
                    continue
                if limits and not it.urgent and len(self.in_status("QA")) >= WIP_LIMITS["QA"]:
                    continue  # reviewed, waiting for a free tester
                self.move(it, "QA", d, 10, 14)

            # 6. Development. Juggling many items costs focus.
            in_prog = [i for i in self.in_status("In Progress") if i.blocked_until is None and i.dev_left > 0]
            n_all = len(self.in_status("In Progress"))
            focus = 1.0 / (1.0 + 0.035 * max(0, n_all - DEVELOPERS))
            capacity = DEVELOPERS * (1 - self.review_share(d)) * focus
            per_item_cap = 1.4 if limits else 1.0   # pairing once WIP is limited
            if in_prog:
                share = min(per_item_cap, capacity / len(in_prog))
                for it in in_prog:
                    it.dev_left -= share * float(self.rng.uniform(0.75, 1.15))
            for it in self.by_priority([i for i in self.in_status("In Progress") if i.dev_left <= 0 and i.blocked_until is None]):
                if limits and not it.urgent and len(self.in_status("Code Review")) >= WIP_LIMITS["Code Review"]:
                    continue  # finished, but the next column is full: help review instead
                self.move(it, "Code Review", d, 12, 16.5)

            # 7. Developers start new work. Urgent bugs always start at once.
            ready = self.by_priority(self.in_status("Ready"))
            for it in [r for r in ready if r.urgent]:
                self.move(it, "In Progress", d, 13, 17.5)   # expedite: ignores the limit
            ready = [r for r in ready if not r.urgent]
            in_prog = self.in_status("In Progress")
            if limits:
                room = WIP_LIMITS["In Progress"] - len(in_prog)
            else:
                unblocked = [i for i in in_prog if i.blocked_until is None]
                room = int(round(self.start_threshold(d) - len(unblocked) + self.rng.normal(0, 0.6)))
            for it in ready[:max(0, min(room, 4))]:
                self.move(it, "In Progress", d, 13, 17.5)

            # 8. Some work gets blocked: a missing answer, an outside team, a vendor.
            for it in self.items:
                if it.status not in ("In Progress", "Code Review") or it.blocked_until is not None:
                    continue
                n = int(it.key.split("-")[1])
                if n in long_blocks and it.status == "In Progress" and d >= 0:
                    long_blocks.discard(n)
                    days = int(self.rng.integers(10, 19))
                elif self.rng.random() < 0.015:
                    days = max(1, int(round(self.lognormal(1.6, 0.8))))
                else:
                    continue
                it.blocks.append([self.stamp(it, d, 12, 17.5), None])
                it.blocked_until = d + days + 2 * (days // 5)   # working days to calendar days

    # ── output in Jira's export format ──────────────────────────────────────
    def write(self, out: Path) -> None:
        out.mkdir(parents=True, exist_ok=True)
        jira = lambda ts: ts.strftime("%d/%b/%y %I:%M %p")
        with open(out / "issues.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["Summary", "Issue key", "Issue Type", "Status", "Priority", "Component/s", "Created", "Resolved"])
            for it in self.items:
                resolved = it.changes[-1][2] if it.status == "Done" else None
                w.writerow([it.summary, it.key, it.type, it.status, it.priority, it.stream,
                            jira(it.created), jira(resolved) if resolved else ""])
        with open(out / "status_changes.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["Issue key", "From Status", "To Status", "Changed"])
            for it in self.items:
                for frm, to, ts in it.changes:
                    w.writerow([it.key, frm, to, jira(ts)])
        with open(out / "flags.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["Issue key", "Flagged", "Unflagged"])
            for it in self.items:
                for start, end in it.blocks:
                    w.writerow([it.key, jira(start), jira(end) if end else ""])


def main() -> None:
    here = Path(__file__).resolve().parent.parent
    sim = Sim()
    sim.run()
    sim.write(here / "data" / "jira-export")
    done = sum(1 for i in sim.items if i.status == "Done")
    print(f"simulated {len(sim.items)} items, {done} done, "
          f"{sum(len(i.changes) for i in sim.items)} status changes, "
          f"{sum(len(i.blocks) for i in sim.items)} blocks")


if __name__ == "__main__":
    main()
