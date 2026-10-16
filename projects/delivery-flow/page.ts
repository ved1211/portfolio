import { initProjectShell } from '../../src/projects/shell';
import { whenEcharts } from '../../src/projects/echarts';
import raw from './data/flow.json';
import { initBoard } from './board';
import { initCharts } from './charts';
import { initForecast } from './forecast';
import { dayToDate, fmtDate, one, type Flow } from './types';

const flow = raw as unknown as Flow;

initProjectShell();

/**
 * Every number in the text is filled in from flow.json, so the words can never
 * drift from the data. The HTML carries the same numbers as a fallback.
 */
function bindNumbers() {
  const P = flow.cycle.percentiles;
  const T = flow.timeInStage;
  const L = flow.littlesLaw;
  const B = flow.blocked.all;
  const D = flow.daily;
  const limits = flow.meta.wipLimits;
  const changeDay = flow.meta.changeWeek ? (flow.meta.changeWeek - 1) * 7 : D.day.length;
  const weekAvg = (a: number[], w: number) => a.slice((w - 1) * 7, w * 7).reduce((x, y) => x + y, 0) / 7;
  const afterFrom = Math.min(changeDay + 14, D.day.length - 1);
  const crAfter = D.codeReview.slice(afterFrom).reduce((x, y) => x + y, 0) / (D.codeReview.length - afterFrom);

  let ipOver = 0, crFirst = 0;
  for (let i = 0; i < changeDay; i++) if (D.inProgress[i] > limits['In Progress']) ipOver++;
  // the first week whose average Code Review queue was over the later limit
  for (let w = 1; w * 7 <= changeDay; w++) {
    if (weekAvg(D.codeReview, w) > limits['Code Review']) { crFirst = w; break; }
  }
  let lastOver = -1;
  for (let i = changeDay; i < D.day.length; i++) {
    if (D.inProgress[i] > limits['In Progress'] || D.codeReview[i] > limits['Code Review'] || D.qa[i] > limits.QA) lastOver = i;
  }

  const blockedKeys = new Set(flow.board.items.filter((it) => it[6].length).map((it) => it[0]));
  const slow = flow.cycle.points.filter((p) => p[1] > P.all.p95);
  const fc = flow.forecast.weeklyThroughput;

  const v: Record<string, string> = {
    items: String(flow.meta.items),
    finished: String(P.all.items),
    all50: one(P.all.p50), all85: one(P.all.p85), all95: one(P.all.p95),
    b50: one(P.before.p50), b85: one(P.before.p85), b95: one(P.before.p95),
    a50: one(P.after.p50), a85: one(P.after.p85), a95: one(P.after.p95),
    a85ceil: String(Math.ceil(P.after.p85)),
    crB: one(T.before.codeReview), crA: one(T.after.codeReview),
    qaB: one(T.before.qa), blkB: one(T.before.blocked),
    crShareB: String(Math.round((T.before.codeReview / T.before.cycle) * 100)),
    tpB: one(L.before.throughputPerDay * 7), tpA: one(L.after.throughputPerDay * 7),
    wipB: one(L.before.avgWip), wipA: one(L.after.avgWip),
    llAllW: one(L.all.avgWip), llAllP: one(L.all.predictedWip),
    effB: String(Math.round(flow.flowEfficiency.before.efficiency * 100)),
    effA: String(Math.round(flow.flowEfficiency.after.efficiency * 100)),
    blkItems: String(B.itemsBlocked), blkShare: one(B.share * 100), blkLongest: one(B.longest),
    longN: String(slow.length), longBlocked: String(slow.filter((p) => blockedKeys.has(p[4])).length),
    cr5: one(weekAvg(D.codeReview, 5)), cr14: one(weekAvg(D.codeReview, 14)), crAfter: one(crAfter),
    ipOverDays: String(ipOver), crOverWeek: String(crFirst || '–'),
    lastOver: lastOver >= 0 ? fmtDate(dayToDate(flow.meta.start, lastOver), { day: 'numeric', month: 'long' }) : 'the first day',
    lastOverAfter: String(Math.max(0, lastOver - changeDay)),
    daysBefore: String(changeDay), changeWeek: String(flow.meta.changeWeek ?? ''),
    fcFrom: String(flow.forecast.fromWeek), fcTo: String(flow.forecast.toWeek),
    fcMin: String(Math.min(...fc)), fcMax: String(Math.max(...fc)),
  };
  document.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => {
    const k = el.dataset.v ?? '';
    if (k in v) el.textContent = v[k];
  });
}

bindNumbers();
const board = initBoard(flow);

whenEcharts()
  .then(() => {
    initCharts(flow, board);
    initForecast(flow, true);
  })
  .catch(() => {
    // The page still reads without charts: every chart has a takeaway and a table.
    initCharts(flow, board, false);
    initForecast(flow, false);
    document.querySelectorAll<HTMLElement>('.pj-chart').forEach((el) => {
      el.style.height = 'auto';
      el.innerHTML = '<p class="kb-note">The chart library could not load. The numbers are in the table below.</p>';
    });
  });
