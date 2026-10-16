import { $, reduceMotion } from '../../src/lib/env';
import { STAGES, dayToDate, fmtDate, type BoardItem, type Flow } from './types';

type Listener = (day: number) => void;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/**
 * The Kanban board replay. Everything is worked out from each item's stage
 * changes, so any day can be drawn without precomputing 182 boards.
 */
export function initBoard(flow: Flow) {
  const board = $('kb');
  const range = $<HTMLInputElement>('kbDay');
  const label = $('kbDate');
  const play = $<HTMLButtonElement>('kbPlay');
  const summary = $('kbSummary');
  const mark = $('kbMark');
  const listeners: Listener[] = [];

  const days = flow.daily.day.length;
  const changeDay = flow.meta.changeWeek ? (flow.meta.changeWeek - 1) * 7 : Infinity;
  const limits = flow.meta.wipLimits;
  const { p50, p85, p95 } = flow.cycle.percentiles.all;
  const types = flow.board.types;
  const streams = flow.board.streams;

  // Open on the day with the most work in progress before the limits.
  const wip = flow.daily.wip;
  let day = 0;
  for (let i = 0; i < Math.min(days, changeDay); i++) if (wip[i] > wip[day]) day = i;

  if (range) { range.max = String(days - 1); range.value = String(day); }
  if (mark && isFinite(changeDay)) mark.style.left = `${(changeDay / (days - 1)) * 100}%`;
  else mark?.remove();

  type Card = { it: BoardItem; step: number; age: number; blocked: boolean; urgent: boolean; doneAt: number };

  function snapshot(d: number): Card[][] {
    const t = d + 1; // end of the day
    const cols: Card[][] = STAGES.map(() => []);
    for (const it of flow.board.items) {
      if (it[4] >= t) continue;
      let step = 0, started = NaN, at = it[4];
      for (const [s, when] of it[5]) {
        if (when >= t) break;
        step = s; at = when;
        if (s === 2 && isNaN(started)) started = when;
      }
      if (step === 5 && t - at > 7) continue;   // Done shows the last seven days only
      const blocked = it[6].some(([s, e]) => s < t && e > t);
      const urgent = types[it[1]] === 'Bug' && it[3] === 0;
      cols[step].push({ it, step, age: isNaN(started) ? 0 : t - started, blocked, urgent, doneAt: at });
    }
    return cols;
  }

  const ageClass = (c: Card) => {
    if (c.step < 2 || c.step > 4) return '';
    if (c.age >= p95) return 'a3';
    if (c.age >= p85) return 'a2';
    if (c.age >= p50) return 'a1';
    return '';
  };

  function cardHTML(c: Card): string {
    const [key, type, stream] = c.it;
    const cls = ['kc', ageClass(c), c.step === 5 ? 'done' : '', c.urgent ? 'urg' : '', c.blocked ? 'blk' : ''].filter(Boolean).join(' ');
    const bits = [`${key} · ${types[type]} · ${streams[stream]}`, STAGES[c.step]];
    if (c.step >= 2 && c.step <= 4) bits.push(`${Math.floor(c.age)} days since started`);
    if (c.blocked) bits.push('blocked');
    if (c.urgent) bits.push('urgent bug');
    return `<span class="${cls}" title="${esc(bits.join(' · '))}">${esc(key)}</span>`;
  }

  let summaryTimer = 0;

  function render(d: number) {
    day = d;
    const cols = snapshot(d);
    const limitsOn = d >= changeDay;
    const date = dayToDate(flow.meta.start, d);
    const week = Math.floor(d / 7) + 1;
    if (label) label.innerHTML = `Week ${week} <span>· ${fmtDate(date)}</span>`;
    if (range) range.setAttribute('aria-valuetext', `Week ${week}, ${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);

    const spoken: string[] = [];
    const html = cols.map((cards, step) => {
      const name = STAGES[step];
      const limit = limits[name];
      const over = limit !== undefined && cards.length > limit;
      let list = cards;
      if (step >= 2 && step <= 4) list = [...cards].sort((a, b) => b.age - a.age);
      if (step === 5) list = [...cards].sort((a, b) => b.doneAt - a.doneAt);
      if (step === 1) list = [...cards].sort((a, b) => a.it[3] - b.it[3]);

      let body: string;
      if (step === 0) {
        const shown = Math.min(cards.length, 24);
        body = `<div class="kb-cards">${'<span class="kc dot"></span>'.repeat(shown)}</div>` +
          (cards.length > shown ? `<div class="kb-more">+${cards.length - shown} more</div>` : '');
      } else {
        body = `<div class="kb-cards">${list.map(cardHTML).join('')}</div>`;
      }
      const limitChip = limit === undefined ? '' :
        `<span class="kb-l${limitsOn ? '' : ' later'}">Limit ${limit}</span>`;
      const count = step === 5 ? `${cards.length}` : `${cards.length}`;
      const sub = step === 5 ? '<div class="kb-more">in the last 7 days</div>' : '';
      spoken.push(`${name}: ${cards.length}${step === 5 ? ' finished in the last 7 days' : ' items'}` +
        (limit !== undefined ? `, limit ${limit}${limitsOn ? '' : ` from week ${flow.meta.changeWeek}`}${over ? (limitsOn ? ', over the limit' : ', over the later limit') : ''}` : ''));
      return `<div class="kb-col${over ? ' over' : ''}">
        <div class="kb-h"><div class="kb-n">${name}</div><div class="kb-c">${count}</div>${sub}${limitChip}
        <div class="kb-over">${limitsOn ? 'Over limit' : 'Over later limit'}</div></div>${body}</div>`;
    }).join('');
    if (board) board.innerHTML = html;

    window.clearTimeout(summaryTimer);
    summaryTimer = window.setTimeout(() => {
      const old = cols.slice(2, 5).flat().filter((c) => c.age >= p85).length;
      if (summary) summary.textContent = `Week ${week}, ${fmtDate(date)}. ${spoken.join('. ')}. ` +
        `${old} started item${old === 1 ? ' is' : 's are'} older than the 85th percentile.`;
    }, 400);
    listeners.forEach((fn) => fn(d));
  }

  range?.addEventListener('input', () => render(Number(range.value)));

  let timer = 0;
  const stop = () => {
    window.clearInterval(timer); timer = 0;
    if (play) { play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); }
  };
  play?.addEventListener('click', () => {
    if (timer) { stop(); return; }
    if (day >= days - 1) setDay(0);
    play.textContent = 'Pause';
    play.setAttribute('aria-pressed', 'true');
    timer = window.setInterval(() => {
      if (day >= days - 1) { stop(); return; }
      setDay(day + 1);
    }, reduceMotion ? 250 : 110);
  });

  function setDay(d: number) {
    const v = Math.max(0, Math.min(days - 1, d));
    if (range) range.value = String(v);
    render(v);
  }

  render(day);
  return {
    onDay: (fn: Listener) => { listeners.push(fn); },
    setDay,
    day: () => day,
  };
}

export type Board = ReturnType<typeof initBoard>;
