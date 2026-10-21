import { $ } from '../../src/lib/env';
import { onThemeChange } from '../../src/lib/theme';
import { eurM, mix, one, pageColor, pct, signedPct, type Supplier } from './types';

export type Weights = [delivery: number, quality: number, price: number, risk: number];
export const DEFAULT_WEIGHTS: Weights = [40, 30, 20, 10];

/** The same weighted average as the Supplier Score measure in measures.dax. */
export function score(s: Supplier, w: Weights): number | null {
  const total = w[0] + w[1] + w[2] + w[3];
  if (s.delivery_score === null || total === 0) return null;
  return (w[0] * s.delivery_score + w[1] * s.quality_score + w[2] * s.price_score + w[3] * s.risk_score) / total;
}

export function ranked(suppliers: Supplier[], w: Weights) {
  return suppliers
    .map((s) => ({ s, score: score(s, w) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.s.spend_rank - b.s.spend_rank);
}

export function rankOf(suppliers: Supplier[], id: string, w: Weights): number {
  return ranked(suppliers, w).findIndex((r) => r.s.SupplierID === id) + 1;
}

/** The scorecard table with its four weight sliders. */
export function initScorecard(suppliers: Supplier[]) {
  const ids = ['wD', 'wQ', 'wP', 'wR'];
  const inputs = ids.map((id) => $<HTMLInputElement>(id));
  const outputs = ids.map((id) => $(`${id}v`));
  const body = document.querySelector<HTMLElement>('#scTable tbody');
  const status = $('scStatus');
  const allBtn = $<HTMLButtonElement>('scAll');
  let showAll = false;

  const weights = (): Weights => inputs.map((i) => Number(i?.value ?? 0)) as Weights;

  function tint(v: number | null): string {
    if (v === null) return 'transparent';
    const lo = pageColor('--sp-score-lo'), mid = pageColor('--sp-score-mid'), hi = pageColor('--sp-score-hi');
    // 60 or less is the low tint, 75 the middle, 90 or more the high tint.
    return v < 75 ? mix(lo, mid, (v - 60) / 15) : mix(mid, hi, (v - 75) / 15);
  }

  function render() {
    const w = weights();
    w.forEach((v, i) => { const o = outputs[i]; if (o) o.textContent = String(v); });
    const rows = ranked(suppliers, w);
    const shown = showAll ? rows : rows.slice(0, 10);
    if (body) {
      body.innerHTML = shown.map(({ s, score: sc }, i) => `
        <tr>
          <td>${sc === null ? '' : i + 1}</td>
          <td class="sc-name">${s.SupplierName}<span class="sc-sub">${s.Category} · ${s.Country}</span></td>
          <td>${eurM(s.spend)}</td>
          <td>${s.otif === null ? 'n/a' : pct(s.otif)}</td>
          <td>${s.reject_rate === null ? 'n/a' : pct(s.reject_rate, 2)}</td>
          <td>${signedPct(s.price_variance)}</td>
          <td>${Math.round(s.risk_score)}</td>
          <td class="sc-score" style="background:${tint(sc)}">${sc === null ? 'n/a' : one(sc)}</td>
        </tr>`).join('');
    }
    if (status) {
      const scored = rows.filter((r) => r.score !== null);
      status.textContent = scored.length
        ? `With these weights, ${scored[0].s.SupplierName} ranks first and ${scored[scored.length - 1].s.SupplierName} last.`
        : 'Set at least one weight above zero to score the suppliers.';
    }
  }

  inputs.forEach((i) => i?.addEventListener('input', render));
  $('scReset')?.addEventListener('click', () => {
    inputs.forEach((i, n) => { if (i) i.value = String(DEFAULT_WEIGHTS[n]); });
    render();
  });
  allBtn?.addEventListener('click', () => {
    showAll = !showAll;
    allBtn.setAttribute('aria-expanded', String(showAll));
    allBtn.textContent = showAll ? 'Show top 10' : `Show all ${suppliers.length}`;
    render();
  });
  onThemeChange(render);
  render();
}
