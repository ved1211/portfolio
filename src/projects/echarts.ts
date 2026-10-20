import { onThemeChange } from '../lib/theme';
import { debounce } from '../lib/env';

/* Apache ECharts is loaded from cdnjs by a <script> tag on the case study
   pages only, so it never weighs on the home page. */
type EC = any;
declare global { interface Window { echarts?: EC } }

export type Palette = Record<
  'ink' | 'ink2' | 'ink3' | 'ink4' | 'rule' | 'ruleSoft' | 'card' | 'paper' | 'signal' |
  'ready' | 'progress' | 'review' | 'qa' | 'done' | 'before' | 'after' | 'age1' | 'age2' | 'age3' | 'warn',
  string
>;

const VARS: Record<keyof Palette, string> = {
  ink: '--ink', ink2: '--ink-2', ink3: '--ink-3', ink4: '--ink-4', rule: '--rule', ruleSoft: '--rule-soft',
  card: '--card', paper: '--paper', signal: '--signal',
  ready: '--viz-ready', progress: '--viz-progress', review: '--viz-review', qa: '--viz-qa', done: '--viz-done',
  before: '--viz-before', after: '--viz-after', age1: '--viz-age-1', age2: '--viz-age-2', age3: '--viz-age-3',
  warn: '--warn',
};

export function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Palette;
  (Object.keys(VARS) as (keyof Palette)[]).forEach((k) => { out[k] = cs.getPropertyValue(VARS[k]).trim(); });
  return out;
}

export function whenEcharts(): Promise<EC> {
  return new Promise((resolve, reject) => {
    if (window.echarts) { resolve(window.echarts); return; }
    const tag = document.getElementById('echarts-js');
    tag?.addEventListener('load', () => resolve(window.echarts));
    tag?.addEventListener('error', () => reject(new Error('Charts could not load')));
  });
}

export const FONT = "'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** Shared look: hairline solid grid, muted axes, text in text colours, card tooltip. */
export function baseOption(p: Palette, narrow: boolean) {
  return {
    animationDuration: 500,
    textStyle: { fontFamily: FONT, color: p.ink2, fontSize: 11 },
    grid: { left: 8, right: narrow ? 10 : 18, top: 18, bottom: 6, containLabel: true },
    tooltip: {
      backgroundColor: p.card, borderColor: p.rule, borderWidth: 1, padding: [8, 10],
      textStyle: { color: p.ink, fontFamily: FONT, fontSize: 12 },
      extraCssText: 'box-shadow: 0 8px 24px -12px rgba(0,0,0,.35); border-radius: 8px;',
    },
  };
}

export function axisStyle(p: Palette) {
  return {
    axisLine: { lineStyle: { color: p.rule } },
    axisTick: { show: false },
    axisLabel: { color: p.ink3, fontFamily: FONT, fontSize: 11 },
    splitLine: { lineStyle: { color: p.ruleSoft, type: 'solid' } },
    nameTextStyle: { color: p.ink3, fontFamily: FONT, fontSize: 11 },
  };
}

export type Mounted = { chart: EC; render: () => void };

/**
 * Draws a chart and redraws it when the theme flips or the width changes,
 * so every chart reads its colours from the same tokens as the page.
 */
export function mount(el: HTMLElement, build: (p: Palette, narrow: boolean) => object, describe: string): Mounted {
  const echarts = window.echarts;
  const chart = echarts.init(el, undefined, { renderer: 'svg' });
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', describe);
  let narrow = el.clientWidth < 520;
  const render = () => {
    narrow = el.clientWidth < 520;
    chart.setOption(build(palette(), narrow), { notMerge: true });
  };
  render();
  onThemeChange(render);
  const ro = new ResizeObserver(debounce(() => {
    const wasNarrow = narrow;
    chart.resize();
    if ((el.clientWidth < 520) !== wasNarrow) render();
  }, 120));
  ro.observe(el);
  return { chart, render };
}

/** A token colour at a given opacity, for washes such as a shaded period. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

/** A plain table twin for a chart, inside <details>. */
export function tableHTML(head: string[], rows: (string | number)[][]): string {
  const th = head.map((h) => `<th scope="col">${h}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('');
  return `<div class="pj-table-wrap"><table class="pj-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
