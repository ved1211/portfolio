import './page.css';
import { initProjectShell } from '../../src/projects/shell';
import { whenEcharts } from '../../src/projects/echarts';
import raw from './data/kpis.json';
import { initCharts } from './charts';
import { DEFAULT_WEIGHTS, initScorecard, rankOf } from './scorecard';
import { intFmt, one, type Kpis } from './types';

const k = raw as unknown as Kpis;

initProjectShell();

/**
 * Every number in the text is filled in from kpis.json, so the words can never
 * drift from the SQL output. The HTML carries the same numbers as a fallback.
 */
function bindNumbers() {
  const o = k.overall[0];
  const S = k.suppliers;
  const total = o.total_spend;
  const P = k.pareto;
  const top3 = S.slice(0, 3);
  const highOpen = k.riskMatrix.filter((r) => r.CountryRiskTier === 'High' && r.DueDiligenceStatus === 'Open');
  const highOverdue = k.riskMatrix.filter((r) => r.CountryRiskTier === 'High' && r.DueDiligenceStatus === 'Overdue');
  const sum = (rows: { spend: number }[]) => rows.reduce((a, r) => a + r.spend, 0);
  const mcu = k.singleSource[0];
  const semis = k.semisLeadTime;
  const q2 = semis.find((r) => r.quarter === '2025 Q2') ?? semis[0];
  const before = semis.filter((r) => r.quarter < q2.quarter).map((r) => r.avg_lead_time_days);
  const [w1, w2] = k.worsening;
  const words = ['none', 'one', 'two', 'three'];
  const openTop3 = top3.filter((s) => s.DueDiligenceStatus !== 'Done').length;

  const v: Record<string, string> = {
    suppliers: String(S.length),
    otherSuppliers: String(S.length - 10),
    countries: String(new Set(S.map((s) => s.Country)).size),
    lines: intFmt(o.po_lines),
    linesRound: intFmt(Math.round(o.po_lines / 1000) * 1000),
    due: intFmt(o.due_lines),
    spendM: one(total / 1e6), spend24M: one(o.spend_2024 / 1e6), spend25M: one(o.spend_2025 / 1e6),
    yoy: one(o.spend_yoy_2025 * 100),
    otif: one(o.otif * 100), lt: one(o.avg_lead_time_days), ltsd: one(o.lead_time_stdev_days),
    rr: (o.reject_rate * 100).toFixed(2), pv: (o.price_variance * 100).toFixed(2),
    top10: one(P[9].cumulative_share * 100), top3: one((sum(top3) / total) * 100),
    top3Open: words[openTop3] ?? String(openTop3),
    highOpenM: one(sum(highOpen) / 1e6), highOpenShare: one((sum(highOpen) / total) * 100),
    highOpenN: String(highOpen.reduce((a, r) => a + r.suppliers, 0)),
    overdueHighM: one(sum(highOverdue) / 1e6),
    ssCount: String(k.singleSource.length), ssM: one(o.single_source_spend / 1e6),
    ssShare: one((o.single_source_spend / total) * 100),
    mcuM: one(mcu.spend / 1e6), mcuSupplier: mcu.SupplierName,
    rankDefault: String(rankOf(S, mcu.SupplierID, DEFAULT_WEIGHTS)),
    rankRisk: String(rankOf(S, mcu.SupplierID, [10, 10, 10, 70])),
    semisQ2: one(q2.avg_lead_time_days),
    semisRange: `${Math.floor(Math.min(...before))} to ${Math.ceil(Math.max(...before))}`,
    semisPv: one(q2.price_variance * 100),
    w1Name: w1.SupplierName, w1First: one(w1.otif_first * 100), w1Last: one(w1.otif_last * 100),
    w1Drop: one((w1.otif_first - w1.otif_last) * 100),
    w2Name: w2.SupplierName, w2First: one(w2.otif_first * 100), w2Last: one(w2.otif_last * 100),
    w2Drop: one((w2.otif_first - w2.otif_last) * 100),
  };
  document.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => {
    const key = el.dataset.v ?? '';
    if (key in v) el.textContent = v[key];
  });
  return v;
}

const values = bindNumbers();
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__sp = values;
initScorecard(k.suppliers);

whenEcharts()
  .then(() => initCharts(k))
  .catch(() => {
    initCharts(k, false);
    document.querySelectorAll<HTMLElement>('.pj-chart').forEach((el) => {
      el.style.height = 'auto';
      el.innerHTML = '<p class="kb-note">The chart library could not load. The numbers are in the table below.</p>';
    });
  });
