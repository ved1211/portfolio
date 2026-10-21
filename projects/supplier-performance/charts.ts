import { $ } from '../../src/lib/env';
import { axisStyle, baseOption, mount, tableHTML, type Palette } from '../../src/projects/echarts';
import { eurM, mix, one, pageColor, pct, signedPct, textOn, type Kpis } from './types';

const swatch = (color: string) =>
  `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px"></span>`;

/** Every chart's accessible name is the takeaway sentence printed under it. */
const take = (el: HTMLElement) =>
  (el.closest('figure')?.querySelector('.pj-take')?.textContent ?? '').replace(/\s+/g, ' ').trim();

export function initCharts(k: Kpis, withCharts = true) {
  // Without the chart library every chart still has its takeaway and table.
  const draw: typeof mount = (el, build, describe) => (withCharts ? mount(el, build, describe) : { chart: null, render: () => {} });

  // ── Pareto: share of spend per supplier, and the running total ─────────
  const paretoEl = $('chPareto');
  if (paretoEl) {
    const P = k.pareto;
    const total = P.reduce((a, r) => a + r.spend, 0);
    draw(paretoEl, (p, narrow) => ({
      ...baseOption(p, narrow),
      grid: { ...baseOption(p, narrow).grid, top: 26, bottom: 30 },
      tooltip: {
        ...baseOption(p, narrow).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: p.ruleSoft } },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = P[ps[0].dataIndex];
          return `<b>${r.spend_rank}. ${r.SupplierName}</b><br>${eurM(r.spend)} · ${pct(r.spend / total)} of spend` +
            `<br>Running total: <b>${pct(r.cumulative_share)}</b>`;
        },
      },
      xAxis: {
        type: 'category', data: P.map((r) => String(r.spend_rank)), ...axisStyle(p),
        name: narrow ? 'Rank' : 'Suppliers ranked by spend', nameLocation: 'middle', nameGap: 26,
        axisLabel: { ...axisStyle(p).axisLabel, interval: narrow ? 9 : 4 },
      },
      yAxis: { type: 'value', max: 1, ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      series: [
        {
          name: 'Share of spend', type: 'bar', barMaxWidth: 14, barCategoryGap: '25%',
          data: P.map((r, i) => ({ value: r.spend / total, itemStyle: { color: i < 10 ? p.after : p.before, borderRadius: [3, 3, 0, 0] } })),
        },
        {
          name: 'Running total', type: 'line', data: P.map((r) => r.cumulative_share), symbol: 'circle', symbolSize: 5,
          showSymbol: false, lineStyle: { color: p.ink, width: 2 }, itemStyle: { color: p.ink },
          markPoint: {
            symbol: 'circle', symbolSize: 8, itemStyle: { color: p.ink, borderColor: p.card, borderWidth: 2 },
            label: { show: true, position: 'right', formatter: `${pct(P[9].cumulative_share)} after 10`, color: p.ink2, fontSize: 11, distance: 8 },
            data: [{ coord: [9, P[9].cumulative_share] }],
          },
        },
      ],
    }), take(paretoEl));
    const t = $('paretoTable');
    if (t) t.innerHTML = tableHTML(['Rank', 'Supplier', 'Spend', 'Share', 'Running total'],
      P.map((r) => [r.spend_rank, r.SupplierName, eurM(r.spend), pct(r.spend / total), pct(r.cumulative_share)]));
  }

  // ── OTIF by order quarter: the two slipping suppliers against the rest ─
  const otifEl = $('chOtif');
  const W = k.worsening;
  if (otifEl && W.length >= 2) {
    const quarters = [...new Set(k.supplierQuarter.map((r) => r.quarter))].sort();
    const ofSupplier = (id: string) => quarters.map((q) => {
      const r = k.supplierQuarter.find((x) => x.SupplierID === id && x.quarter === q);
      return r && r.otif !== null && r.due_lines > 0 ? { value: r.otif, n: r.due_lines } : { value: null, n: 0 };
    });
    // Everyone else: OTIF lines over due lines, pooled across suppliers.
    const others = quarters.map((q) => {
      const rows = k.supplierQuarter.filter((x) => x.quarter === q && x.SupplierID !== W[0].SupplierID && x.SupplierID !== W[1].SupplierID && x.otif !== null);
      const due = rows.reduce((a, r) => a + r.due_lines, 0);
      return { value: due ? rows.reduce((a, r) => a + (r.otif as number) * r.due_lines, 0) / due : null, n: due };
    });
    const lines = [
      { name: W[0].SupplierName, data: ofSupplier(W[0].SupplierID), color: () => pageColor('--sp-line-a'), width: 2.5 },
      { name: W[1].SupplierName, data: ofSupplier(W[1].SupplierID), color: () => pageColor('--sp-line-b'), width: 2.5 },
      { name: 'All other suppliers', data: others, color: () => pageColor('--sp-others'), width: 2 },
    ];
    draw(otifEl, (p, narrow) => ({
      ...baseOption(p, narrow),
      grid: { ...baseOption(p, narrow).grid, right: narrow ? 12 : 120 },
      tooltip: {
        ...baseOption(p, narrow).tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: p.ink3 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return `<b>Ordered in ${quarters[i]}</b><br>` + lines.map((l) => {
            const d = l.data[i];
            return `${swatch(l.color())}${l.name}: <b>${d.value === null ? 'n/a' : pct(d.value)}</b> <span style="opacity:.7">(${d.n} lines due)</span>`;
          }).join('<br>');
        },
      },
      xAxis: { type: 'category', data: quarters, boundaryGap: false, ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: string) => (narrow ? v.replace('20', "'").replace(' ', '\n') : v) } },
      yAxis: { type: 'value', min: 0, max: 1, ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      series: lines.map((l) => ({
        name: l.name, type: 'line', data: l.data.map((d) => d.value), connectNulls: false,
        symbol: 'circle', symbolSize: 8, lineStyle: { color: l.color(), width: l.width },
        itemStyle: { color: l.color(), borderColor: p.card, borderWidth: 2 },
        endLabel: { show: !narrow, formatter: () => l.name.split(' ')[0], color: p.ink2, fontSize: 11, distance: 8 },
        emphasis: { focus: 'series' },
      })),
    }), take(otifEl));
    const t = $('otifTable');
    if (t) t.innerHTML = tableHTML(['Order quarter', ...lines.map((l) => l.name)],
      quarters.map((q, i) => [q, ...lines.map((l) => (l.data[i].value === null ? 'n/a' : `${pct(l.data[i].value as number)} (${l.data[i].n})`))]));
  }

  // ── Risk matrix: spend by tier and assessment status ──────────────────
  const riskEl = $('chRisk');
  if (riskEl) {
    const tiers = ['Low', 'Medium', 'High'];
    const statuses = ['Done', 'Open', 'Overdue'];
    const cell = (t: string, s: string) => k.riskMatrix.find((r) => r.CountryRiskTier === t && r.DueDiligenceStatus === s);
    const max = Math.max(...k.riskMatrix.map((r) => r.spend));
    draw(riskEl, (p, narrow) => {
      const lo = pageColor('--sp-heat-lo'), hi = pageColor('--sp-heat-hi');
      const data = tiers.flatMap((t, y) => statuses.map((s, x) => {
        const c = cell(t, s);
        const fill = c ? mix(lo, hi, Math.sqrt(c.spend / max)) : p.card;
        return {
          value: [x, y, c ? c.spend / 1e6 : 0],
          itemStyle: { color: fill, borderColor: p.card, borderWidth: 3, borderRadius: 6 },
          label: { color: c ? textOn(fill) : p.ink3 },
          suppliers: c?.suppliers ?? 0,
        };
      }));
      return {
        ...baseOption(p, narrow),
        grid: { ...baseOption(p, narrow).grid, top: 30, bottom: 4 },
        tooltip: {
          ...baseOption(p, narrow).tooltip, trigger: 'item',
          formatter: (o: { data: { value: [number, number, number]; suppliers: number } }) =>
            `<b>${tiers[o.data.value[1]]} tier, assessment ${statuses[o.data.value[0]].toLowerCase()}</b><br>` +
            `€${one(o.data.value[2])}M · ${o.data.suppliers} supplier${o.data.suppliers === 1 ? '' : 's'}`,
        },
        xAxis: { type: 'category', data: statuses.map((s) => `Assessment ${s.toLowerCase()}`), position: 'top', ...axisStyle(p),
          axisLine: { show: false }, splitLine: { show: false }, axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: string) => (narrow ? v.replace('Assessment ', '') : v) } },
        yAxis: { type: 'category', data: tiers.map((t) => `${t} tier`), inverse: false, ...axisStyle(p), axisLine: { show: false }, splitLine: { show: false } },
        series: [{
          type: 'heatmap', data,
          label: { show: true, fontSize: 12, fontWeight: 600,
            formatter: (o: { data: { value: [number, number, number]; suppliers: number } }) =>
              o.data.suppliers ? `€${one(o.data.value[2])}M\n{n|${o.data.suppliers} supplier${o.data.suppliers === 1 ? '' : 's'}}` : '–',
            rich: { n: { fontSize: 10, fontWeight: 400, lineHeight: 16 } } },
          emphasis: { disabled: true },
        }],
      };
    }, take(riskEl));
    const t = $('riskTable');
    if (t) t.innerHTML = tableHTML(['Risk tier', ...statuses.map((s) => `Assessment ${s.toLowerCase()}`)],
      tiers.map((tier) => [tier, ...statuses.map((s) => { const c = cell(tier, s); return c ? `${eurM(c.spend)} (${c.suppliers})` : '–'; })]));
  }

  // ── Single-source materials (a table, always visible) ──────────────────
  const ss = $('ssTable');
  if (ss) {
    // The only supplier sits under the material name, so four columns fit a phone.
    const table = (rows: typeof k.singleSource) => `<div class="pj-table-wrap"><table class="pj-table">
      <thead><tr><th scope="col">Material and its only supplier</th><th scope="col">Risk tier</th><th scope="col">Assessment</th><th scope="col">Spend</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><th scope="row" class="sc-name">${r.MaterialName}${r.Critical === 'Yes' ? ' (critical)' : ''}
        <span class="sc-sub">${r.SupplierName}</span></th><td>${r.CountryRiskTier}</td><td>${r.DueDiligenceStatus}</td><td>${eurM(r.spend)}</td></tr>`).join('')}</tbody>
      </table></div>`;
    ss.innerHTML = table(k.singleSource.slice(0, 6)) +
      `<details><summary>Show all ${k.singleSource.length}</summary>${table(k.singleSource.slice(6))}</details>`;
  }

  // ── Semiconductor lead time by order quarter ───────────────────────────
  const semisEl = $('chSemis');
  if (semisEl) {
    const all = k.semisLeadTime;
    const median = [...all.map((r) => r.delivered_lines)].sort((a, b) => a - b)[Math.floor(all.length / 2)];
    // A quarter whose orders have mostly not arrived yet would look shorter than it is.
    const Q = all.filter((r, i) => !(i === all.length - 1 && r.delivered_lines < median / 2));
    const note = $('semisNote');
    if (note && Q.length === all.length) note.remove();
    const peak = Q.reduce((a, r) => (r.avg_lead_time_days > a.avg_lead_time_days ? r : a), Q[0]);
    draw(semisEl, (p: Palette, narrow) => ({
      ...baseOption(p, narrow),
      grid: { ...baseOption(p, narrow).grid, top: 26 },
      tooltip: {
        ...baseOption(p, narrow).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: p.ruleSoft } },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = Q[ps[0].dataIndex];
          return `<b>Ordered in ${r.quarter}</b><br>Took ${one(r.avg_lead_time_days)} days on average` +
            `<br>Promised ${one(r.avg_promised_days)} days<br>Price ${signedPct(r.price_variance)} against standard`;
        },
      },
      xAxis: { type: 'category', data: Q.map((r) => r.quarter), ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: string) => (narrow ? v.replace('20', "'").replace(' ', '\n') : v) } },
      yAxis: { type: 'value', ...axisStyle(p), name: 'Days', nameGap: 10 },
      series: [{
        type: 'bar', barMaxWidth: 24,
        data: Q.map((r) => ({
          value: r.avg_lead_time_days,
          itemStyle: { color: r === peak ? p.review : p.before, borderRadius: [3, 3, 0, 0] },
          label: { show: r === peak, position: 'top', formatter: `${one(r.avg_lead_time_days)} days`, color: p.ink2, fontSize: 11 },
        })),
      }],
    }), take(semisEl));
    const t = $('semisTable');
    if (t) t.innerHTML = tableHTML(['Order quarter', 'Lead time', 'Promised', 'Price against standard', 'Lines delivered'],
      all.map((r) => [r.quarter, `${one(r.avg_lead_time_days)} days`, `${one(r.avg_promised_days)} days`, signedPct(r.price_variance), r.delivered_lines]));
  }
}
