/** Shape of data/kpis.json, written by analysis/run_kpis.py. */
export interface Supplier {
  SupplierID: string; SupplierName: string; Country: string; Category: string;
  CountryRiskTier: 'Low' | 'Medium' | 'High'; DueDiligenceStatus: 'Done' | 'Open' | 'Overdue';
  SingleSource: string; ISO9001: string; ISO14001: string;
  spend: number; spend_share: number; spend_rank: number; due_lines: number;
  otif: number | null; avg_lead_time_days: number | null; lead_time_stdev_days: number | null;
  reject_rate: number | null; price_variance: number;
  delivery_score: number | null; quality_score: number; price_score: number; risk_score: number;
  supplier_score: number | null;
}

export interface Kpis {
  meta: { simulated: boolean; note: string };
  overall: {
    total_spend: number; spend_2024: number; spend_2025: number; spend_yoy_2025: number;
    po_lines: number; due_lines: number; otif: number; avg_lead_time_days: number;
    lead_time_stdev_days: number; reject_rate: number; price_variance: number;
    single_source_spend: number; cutoff_date: string;
  }[];
  suppliers: Supplier[];
  pareto: { spend_rank: number; SupplierID: string; SupplierName: string; spend: number; cumulative_share: number }[];
  monthly: { month: string; spend: number; otif: number | null; due_lines: number }[];
  supplierQuarter: { SupplierID: string; quarter: string; otif: number | null; due_lines: number }[];
  worsening: { SupplierID: string; SupplierName: string; Category: string; Country: string; otif_first: number; otif_last: number; change: number }[];
  semisLeadTime: { quarter: string; avg_lead_time_days: number; avg_promised_days: number; price_variance: number; delivered_lines: number }[];
  riskMatrix: { CountryRiskTier: string; DueDiligenceStatus: string; suppliers: number; spend: number }[];
  singleSource: { MaterialID: string; MaterialName: string; Category: string; Critical: string; SupplierID: string; SupplierName: string; CountryRiskTier: string; DueDiligenceStatus: string; spend: number }[];
  category: { Category: string; spend: number; suppliers: number }[];
}

export const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
export const signedPct = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
export const eurM = (x: number) => `€${(x / 1e6).toFixed(1)}M`;
export const intFmt = (x: number) => Math.round(x).toLocaleString('en-GB');

/** A colour token defined on the page body (page.css) rather than on :root. */
export const pageColor = (name: string) => getComputedStyle(document.body).getPropertyValue(name).trim();

/** Mix two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('');
}

/** Dark ink or white, whichever reads on a coloured fill. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#151815' : '#ffffff';
}
