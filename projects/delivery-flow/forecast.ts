import { $ } from '../../src/lib/env';
import { axisStyle, baseOption, mount, tableHTML, type Mounted } from '../../src/projects/echarts';
import { fmtDate, type Flow } from './types';

const RUNS = 10_000;

/** Small seeded random generator, so the same inputs always give the same forecast. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The n-th working day (Monday to Friday) counting the start date as day 1 when it is one. */
function finishDate(start: Date, workdays: number): Date {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  for (let n = 1; n < workdays; n++) {
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  }
  return d;
}

export function initForecast(flow: Flow, chartsReady: boolean) {
  const form = $<HTMLFormElement>('fcForm');
  const itemsIn = $<HTMLInputElement>('fcItems');
  const startIn = $<HTMLInputElement>('fcStart');
  const err = $('fcErr');
  const samples = flow.forecast.weeklyThroughput;
  if (!form || !itemsIn || !startIn) return;

  // Default start: the coming Monday (today, if today is a Monday).
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((8 - today.getDay()) % 7));
  startIn.value = iso(monday);

  let result = { weeks: [] as number[], share: [] as number[], cum: [] as number[], items: 30, start: monday, p: { 50: 0, 85: 0, 95: 0 } };
  let chart: Mounted | null = null;

  function simulate(items: number, start: Date) {
    const rand = mulberry32(items * 7919 + start.getFullYear() * 400 + start.getMonth() * 31 + start.getDate());
    const counts = new Map<number, number>();
    for (let r = 0; r < RUNS; r++) {
      // Draw whole weeks of throughput. In the week that reaches the total,
      // place the finish on the working day that share of the week implies.
      let done = 0, weeks = 0, workdays = 0;
      while (weeks < 520) {
        const week = samples[Math.floor(rand() * samples.length)];
        weeks++;
        if (done + week >= items) {
          workdays = (weeks - 1) * 5 + Math.max(1, Math.ceil(((items - done) / week) * 5));
          break;
        }
        done += week;
      }
      counts.set(workdays, (counts.get(workdays) ?? 0) + 1);
    }
    const found = [...counts.keys()].sort((a, b) => a - b);
    const weeks: number[] = [];
    for (let w = found[0]; w <= found[found.length - 1]; w++) weeks.push(w);   // no gaps on the chart
    const share = weeks.map((w) => (counts.get(w) ?? 0) / RUNS);
    let acc = 0;
    const cum = share.map((s) => (acc += s));
    const at = (q: number) => weeks[cum.findIndex((c) => c >= q - 1e-9)];
    return { weeks, share, cum, items, start, p: { 50: at(0.5), 85: at(0.85), 95: at(0.95) } };
  }

  const label = (w: number) => fmtDate(finishDate(result.start, w), { weekday: 'short', day: 'numeric', month: 'short' });

  function show() {
    const { p, items, start } = result;
    const full = (w: number) => fmtDate(finishDate(start, w));
    ($('fc50') as HTMLElement).textContent = full(p[50]);
    ($('fc85') as HTMLElement).textContent = full(p[85]);
    ($('fc95') as HTMLElement).textContent = full(p[95]);
    const take = $('fcTake');
    if (take) take.textContent = `In 85% of the 10,000 runs, ${items} item${items === 1 ? ' was' : 's were'} done by ` +
      `${full(p[85])}, and in half of them by ${full(p[50])}.`;
    const t = $('fcTable');
    if (t) t.innerHTML = tableHTML(['Done by', 'Working days', 'Share of runs', 'Done by then'],
      result.weeks.map((w, i) => [full(w), w, `${(result.share[i] * 100).toFixed(1)}%`, `${(result.cum[i] * 100).toFixed(1)}%`]));
    chart?.render();
  }

  function run() {
    const items = Number(itemsIn!.value);
    const [y, m, d] = (startIn!.value || '').split('-').map(Number);
    if (!Number.isInteger(items) || items < 1 || items > 500) {
      if (err) err.textContent = 'Enter a whole number of items between 1 and 500.';
      return;
    }
    if (!y || !m || !d) {
      if (err) err.textContent = 'Choose a start date.';
      return;
    }
    if (err) err.textContent = '';
    result = simulate(items, new Date(y, m - 1, d));
    show();
  }

  if (chartsReady) {
    const el = $('chForecast');
    if (el) chart = mount(el, (p, narrow) => ({
      ...baseOption(p, narrow),
      tooltip: { ...baseOption(p, narrow).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: p.ruleSoft } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return `<b>Done on ${label(result.weeks[i])}</b><br>${(result.share[i] * 100).toFixed(1)}% of runs finished that day<br>` +
            `${(result.cum[i] * 100).toFixed(1)}% finished by then`;
        } },
      xAxis: { type: 'category', data: result.weeks.map(label), ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, hideOverlap: true } },
      yAxis: { type: 'value', ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      series: [{
        type: 'bar', barMaxWidth: 24, data: result.share,
        itemStyle: { color: p.after, borderRadius: [3, 3, 0, 0] },
        markLine: {
          silent: true, symbol: 'none',
          data: ([50, 85, 95] as const).map((q) => ({
            xAxis: label(result.p[q]),
            lineStyle: { color: q === 85 ? p.ink : p.ink3, type: 'dashed', width: q === 85 ? 1.5 : 1 },
            label: { show: !narrow || q === 85, formatter: `${q}%`, position: 'end', color: p.ink2, fontSize: 10 },
          })),
        },
      }],
    }), 'Histogram of finish dates across 10,000 simulated runs.');
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  itemsIn.addEventListener('change', run);
  startIn.addEventListener('change', run);
  run();
}
