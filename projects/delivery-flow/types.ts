/** Shape of data/flow.json, written by analysis/run_analysis.py. */
export type Move = [step: number, day: number];
export type Block = [start: number, end: number];
export type BoardItem = [key: string, type: number, stream: number, priority: number, created: number, moves: Move[], blocks: Block[]];

type Pct = { items: number; p50: number; p85: number; p95: number; mean: number };
type Stage = { items: number; inProgress: number; codeReview: number; qa: number; blocked: number; other: number; cycle: number };
type Little = { days: number; avgWip: number; throughputPerDay: number; avgCycle: number; predictedWip: number };
type Group = 'before' | 'after' | 'all';

export interface Flow {
  meta: {
    simulated: boolean; note: string; start: string; end: string;
    changeDate: string | null; changeWeek: number | null;
    wipLimits: Record<string, number>; items: number;
  };
  weekly: { week: number[]; start: string[]; finished: number[] };
  daily: { day: string[]; backlog: number[]; ready: number[]; inProgress: number[]; codeReview: number[]; qa: number[]; wip: number[]; done: number[] };
  cycle: { points: [doneDay: number, days: number, period: string, type: string, key: string][]; percentiles: Record<Group, Pct> };
  timeInStage: Record<Group, Stage>;
  flowEfficiency: Record<Group, { efficiency: number; waiting: number }>;
  blocked: Record<Group, { items: number; itemsBlocked: number; days: number; share: number; longest: number }>;
  aging: { key: string; type: string; stage: string; age: number }[];
  littlesLaw: Record<Group, Little>;
  board: { types: string[]; streams: string[]; priorities: string[]; items: BoardItem[] };
  forecast: { fromWeek: number; toWeek: number; weeklyThroughput: number[] };
}

export const STAGES = ['Backlog', 'Ready', 'In Progress', 'Code Review', 'QA', 'Done'] as const;

/** Day index (0 = start date) to a Date at local midnight. */
export function dayToDate(start: string, day: number): Date {
  const [y, m, d] = start.split('-').map(Number);
  return new Date(y, m - 1, d + Math.floor(day));
}

export const fmtDate = (d: Date, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  d.toLocaleDateString('en-GB', opts);

export const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
