import { $ } from '../../src/lib/env';
import { alpha, axisStyle, baseOption, mount, tableHTML, type Palette } from '../../src/projects/echarts';
import type { Board } from './board';
import { dayToDate, fmtDate, one, type Flow } from './types';

const short = (d: Date) => fmtDate(d, { day: 'numeric', month: 'short' });

/** White or ink, whichever reads on a coloured fill. */
function textOn(hex: string): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.3 ? '#151815' : '#ffffff';
}

const swatch = (color: string) =>
  `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px"></span>`;

export function initCharts(flow: Flow, board: Board, withCharts = true) {
  // Without the chart library every chart still has its takeaway and table.
  const draw: typeof mount = (el, build, describe) => (withCharts ? mount(el, build, describe) : { chart: null, render: () => {} });
  const D = flow.daily;
  const start = flow.meta.start;
  const labels = D.day.map((_, i) => short(dayToDate(start, i)));
  const changeDay = flow.meta.changeWeek ? (flow.meta.changeWeek - 1) * 7 : null;
  const changeLabel = changeDay !== null ? labels[changeDay] : null;
  // Each chart's accessible name is the takeaway sentence printed under it.
  const take = (el: HTMLElement) =>
    (el.closest('figure')?.querySelector('.pj-take')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const everyNth = (narrow: boolean) => (narrow ? 41 : 27);
  // The weeks under WIP limits are shaded the same way on every chart.
  const limitsArea = (p: Palette, from: string | number, to: string | number) => ({
    silent: true,
    itemStyle: { color: alpha(p.ink, 0.045) },
    label: { show: true, position: 'insideTopLeft', formatter: 'WIP limits', color: p.ink3, fontSize: 10, padding: [4, 6] },
    data: [[{ xAxis: from }, { xAxis: to }]],
  });

  // ── Cumulative flow diagram, synced with the board ─────────────────────
  const cfdEl = $('chCfd');
  if (cfdEl) {
    const stack = [
      { id: 'done', name: 'Done since week 1', data: D.done, color: 'done' as const },
      { id: 'qa', name: 'QA', data: D.qa, color: 'qa' as const },
      { id: 'cr', name: 'Code Review', data: D.codeReview, color: 'review' as const },
      { id: 'ip', name: 'In Progress', data: D.inProgress, color: 'progress' as const },
      { id: 'ready', name: 'Ready', data: D.ready, color: 'ready' as const },
    ];
    const dayLine = (p: Palette, d: number) => ({
      silent: true, symbol: 'none', animation: false,
      lineStyle: { color: p.ink, width: 1.5, type: 'solid' },
      label: { show: true, position: 'end', formatter: 'Board', color: p.ink2, fontSize: 10 },
      data: [{ xAxis: labels[d] }],
    });
    const { chart } = draw(cfdEl, (p, narrow) => ({
      ...baseOption(p, narrow),
      tooltip: {
        ...baseOption(p, narrow).tooltip, trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: p.ink3 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          const rows = [...stack].reverse().map((s) => `${swatch(p[s.color])}${s.name}: <b>${s.data[i]}</b>`);
          return `<b>${fmtDate(dayToDate(start, i))}</b><br>${rows.join('<br>')}`;
        },
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false, ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, interval: everyNth(narrow) }, splitLine: { show: false } },
      grid: { ...baseOption(p, narrow).grid, top: 26 },
      yAxis: { type: 'value', ...axisStyle(p), name: 'Items', nameGap: 10 },
      series: stack.map((s, i) => ({
        id: s.id, name: s.name, type: 'line', stack: 'cfd', data: s.data, symbol: 'none',
        lineStyle: { width: 1, color: p.card }, areaStyle: { color: p[s.color], opacity: 1 },
        emphasis: { disabled: true },
        markLine: i === stack.length - 1 ? dayLine(p, board.day()) : undefined,
        markArea: i === stack.length - 1 && changeLabel ? limitsArea(p, changeLabel, labels[labels.length - 1]) : undefined,
      })),
    }), take(cfdEl));
    if (chart) board.onDay((d) => {
      chart.setOption({ series: [{ id: 'ready', markLine: { data: [{ xAxis: labels[d] }] } }] });
    });
    chart?.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
      const pt = [e.offsetX, e.offsetY];
      if (!chart.containPixel('grid', pt)) return;
      const idx = chart.convertFromPixel({ seriesIndex: 0 }, pt)[0];
      if (typeof idx === 'number' && isFinite(idx)) board.setDay(Math.round(idx));
    });
    const weekRows = flow.weekly.week.map((w) => {
      const i = Math.min(w * 7 - 1, D.day.length - 1);
      return [`Week ${w}`, short(dayToDate(start, i)), D.ready[i], D.inProgress[i], D.codeReview[i], D.qa[i], D.done[i]];
    });
    const t = $('cfdTable');
    if (t) t.innerHTML = tableHTML(['Week', 'Last day', 'Ready', 'In Progress', 'Code Review', 'QA', 'Done'], weekRows);
  }

  // ── Cycle time scatter with percentile lines ───────────────────────────
  const cycleEl = $('chCycle');
  if (cycleEl) {
    const P = flow.cycle.percentiles;
    const t0 = dayToDate(start, 0).getTime();
    const tEnd = dayToDate(start, D.day.length).getTime();
    const tChange = changeDay !== null ? dayToDate(start, changeDay).getTime() : tEnd;
    const ms = (day: number) => t0 + day * 86400000;
    const pts = (period: string) => flow.cycle.points.filter((x) => x[2] === period)
      .map((x) => ({ value: [ms(x[0]), x[1]], key: x[4], type: x[3] }));
    // Percentile lines are thresholds, so they are dashed. The 50th label sits
    // under its line so close values do not collide; phones label the 85th only.
    const segs = (p: Palette, group: 'before' | 'after', x1: number, x2: number, side: 'Start' | 'End', narrow: boolean) =>
      (['p50', 'p85', 'p95'] as const).map((k) => [
        { coord: [x1, P[group][k]], lineStyle: { color: group === 'before' ? p.ink3 : p.signal, width: k === 'p85' ? 1.5 : 1, type: 'dashed' },
          label: { show: !narrow || k === 'p85', position: `inside${side}${k === 'p50' ? 'Bottom' : 'Top'}`, formatter: `${k.slice(1)}th ${one(P[group][k])} d`,
            color: p.ink2, fontSize: 10 } },
        { coord: [x2, P[group][k]] },
      ]);
    draw(cycleEl, (p, narrow) => ({
      ...baseOption(p, narrow),
      tooltip: {
        ...baseOption(p, narrow).tooltip, trigger: 'item',
        formatter: (o: { data: { value: [number, number]; key: string; type: string }; seriesName: string }) =>
          `<b>${o.data.key}</b> · ${o.data.type}<br>Finished ${fmtDate(new Date(o.data.value[0]))}<br>` +
          `Cycle time <b>${one(o.data.value[1])} days</b><br>${o.seriesName}`,
      },
      xAxis: { type: 'time', min: t0, max: tEnd, ...axisStyle(p), splitLine: { show: false },
        axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: number) => short(new Date(v)), hideOverlap: true } },
      yAxis: { type: 'value', ...axisStyle(p), name: 'Days', nameGap: 10 },
      series: [
        { name: 'Started before WIP limits', type: 'scatter', data: pts('before'), symbolSize: 8,
          itemStyle: { color: p.before, borderColor: p.card, borderWidth: 1.5 },
          markLine: { silent: true, symbol: 'none', data: segs(p, 'before', t0, tChange, 'Start', narrow) },
          markArea: changeDay !== null ? limitsArea(p, tChange, tEnd) : undefined },
        { name: 'Started after WIP limits', type: 'scatter', data: pts('after'), symbolSize: 8,
          itemStyle: { color: p.after, borderColor: p.card, borderWidth: 1.5 },
          markLine: { silent: true, symbol: 'none', data: segs(p, 'after', tChange, tEnd, 'End', narrow) } },
      ],
    }), take(cycleEl));
    const t = $('cycleTable');
    const rows = (['before', 'after', 'all'] as const).map((g) => [
      { before: 'Started before limits', after: 'Started after limits', all: 'All finished items' }[g],
      P[g].items, one(P[g].p50), one(P[g].p85), one(P[g].p95), one(P[g].mean)]);
    if (t) t.innerHTML = tableHTML(['Group', 'Items', '50th', '85th', '95th', 'Average'], rows);
  }

  // ── Weekly throughput ──────────────────────────────────────────────────
  const tpEl = $('chThroughput');
  const W = flow.weekly;
  const cw = flow.meta.changeWeek ?? Infinity;
  if (tpEl) {
    draw(tpEl, (p, narrow) => ({
      ...baseOption(p, narrow),
      tooltip: { ...baseOption(p, narrow).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: p.ruleSoft } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return `<b>Week ${W.week[i]}</b> · from ${short(new Date(W.start[i]))}<br>${W.finished[i]} items finished`;
        } },
      xAxis: { type: 'category', data: W.week.map((w) => `W${w}`), ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, interval: narrow ? 4 : 1 } },
      yAxis: { type: 'value', ...axisStyle(p), minInterval: 1 },
      series: [{
        type: 'bar', barMaxWidth: 18, barCategoryGap: '30%',
        data: W.finished.map((v, i) => ({ value: v, itemStyle: { color: W.week[i] >= cw ? p.after : p.before, borderRadius: [3, 3, 0, 0] } })),
      }],
    }), take(tpEl));
    const t = $('throughputTable');
    if (t) t.innerHTML = tableHTML(['Week', 'Starts', 'Finished'], W.week.map((w, i) => [`Week ${w}`, short(new Date(W.start[i])), W.finished[i]]));
  }

  // ── WIP by stage, stacked ──────────────────────────────────────────────
  const wipEl = $('chWip');
  if (wipEl) {
    const total = Object.values(flow.meta.wipLimits).reduce((a, b) => a + b, 0);
    const parts = [
      { name: 'In Progress', data: D.inProgress, color: 'progress' as const },
      { name: 'Code Review', data: D.codeReview, color: 'review' as const },
      { name: 'QA', data: D.qa, color: 'qa' as const },
    ];
    draw(wipEl, (p, narrow) => ({
      ...baseOption(p, narrow),
      tooltip: { ...baseOption(p, narrow).tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: p.ink3 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return `<b>${fmtDate(dayToDate(start, i))}</b><br>` +
            [...parts].reverse().map((s) => `${swatch(p[s.color])}${s.name}: <b>${s.data[i]}</b>`).join('<br>') +
            `<br>Total WIP: <b>${D.wip[i]}</b>`;
        } },
      xAxis: { type: 'category', data: labels, boundaryGap: false, ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, interval: everyNth(narrow) }, splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(p), name: 'Items', nameGap: 10, minInterval: 1 },
      series: parts.map((s, i) => ({
        name: s.name, type: 'line', stack: 'wip', data: s.data, symbol: 'none', step: 'end',
        lineStyle: { width: 1, color: p.card }, areaStyle: { color: p[s.color], opacity: 0.9 },
        emphasis: { disabled: true },
        markLine: i === parts.length - 1 && changeLabel ? {
          silent: true, symbol: 'none',
          data: [
            [{ coord: [changeLabel, total], lineStyle: { color: p.ink, type: 'dashed', width: 1.2 },
               label: { show: true, formatter: `Sum of the limits: ${total}`, position: 'insideEndTop', color: p.ink2, fontSize: 10 } },
             { coord: [labels[labels.length - 1], total] }],
          ],
        } : undefined,
        markArea: i === parts.length - 1 && changeLabel ? limitsArea(p, changeLabel, labels[labels.length - 1]) : undefined,
      })),
    }), take(wipEl));
    const t = $('wipTable');
    const avg = (a: number[], w: number) => one(a.slice((w - 1) * 7, w * 7).reduce((x, y) => x + y, 0) / 7);
    if (t) t.innerHTML = tableHTML(['Week', 'In Progress', 'Code Review', 'QA', 'Total WIP'],
      W.week.map((w) => [`Week ${w}`, avg(D.inProgress, w), avg(D.codeReview, w), avg(D.qa, w), avg(D.wip, w)]));
  }

  // ── Little's Law table (always visible) ────────────────────────────────
  const ll = $('littleTable');
  if (ll) {
    const L = flow.littlesLaw;
    const name = { before: `Weeks 1 to ${cw - 1}`, after: `Weeks ${cw} to ${W.week.length}`, all: `All ${W.week.length} weeks` };
    ll.innerHTML = tableHTML(['Window', 'Average WIP', 'Throughput per day', 'Average cycle time', 'Predicted WIP'],
      (['before', 'after', 'all'] as const).filter((k) => L[k]).map((k) => [name[k], one(L[k].avgWip),
        L[k].throughputPerDay.toFixed(2), `${one(L[k].avgCycle)} days`, one(L[k].predictedWip)]));
  }

  // ── Time in each stage ─────────────────────────────────────────────────
  const timeEl = $('chTime');
  if (timeEl) {
    const T = flow.timeInStage;
    const groups = ['after', 'before'] as const;
    const parts = [
      { name: 'Blocked', key: 'blocked' as const, color: 'ready' as const },
      { name: 'In Progress', key: 'inProgress' as const, color: 'progress' as const },
      { name: 'Code Review', key: 'codeReview' as const, color: 'review' as const },
      { name: 'QA', key: 'qa' as const, color: 'qa' as const },
    ];
    const cat = (g: 'before' | 'after', narrow: boolean) =>
      `${g === 'before' ? (narrow ? 'Before' : 'Started before limits') : (narrow ? 'After' : 'Started after limits')}\n${one(T[g].cycle)} days`;
    draw(timeEl, (p, narrow) => ({
      ...baseOption(p, narrow),
      grid: { ...baseOption(p, narrow).grid, top: 6 },
      tooltip: { ...baseOption(p, narrow).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: p.ruleSoft } },
        formatter: (ps: { dataIndex: number }[]) => {
          const g = groups[ps[0].dataIndex];
          return `<b>${g === 'before' ? 'Started before limits' : 'Started after limits'}</b><br>` +
            parts.map((s) => `${swatch(p[s.color])}${s.name}: <b>${one(T[g][s.key])} days</b>`).join('<br>') +
            `<br>Average cycle time: <b>${one(T[g].cycle)} days</b>`;
        } },
      xAxis: { type: 'value', ...axisStyle(p) },
      yAxis: { type: 'category', data: groups.map((g) => cat(g, narrow)), ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, color: p.ink2, lineHeight: 15 } },
      series: parts.map((s) => ({
        name: s.name, type: 'bar', stack: 't', barMaxWidth: 24,
        itemStyle: { color: p[s.color], borderColor: p.card, borderWidth: 1 },
        label: { show: true, formatter: (o: { value: number }) => (o.value >= (narrow ? 1.4 : 0.9) ? one(o.value) : ''),
          color: textOn(p[s.color]), fontSize: 10 },
        data: groups.map((g) => T[g][s.key]),
      })),
    }), take(timeEl));
    const t = $('timeTable');
    if (t) t.innerHTML = tableHTML(['Group', 'Blocked', 'In Progress', 'Code Review', 'QA', 'Cycle time'],
      (['before', 'after'] as const).map((g) => [g === 'before' ? 'Started before limits' : 'Started after limits',
        one(T[g].blocked), one(T[g].inProgress), one(T[g].codeReview), one(T[g].qa), one(T[g].cycle)]));
  }
}
