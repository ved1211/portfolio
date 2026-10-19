import { $, reduceMotion } from './env';

/** Fixed nav height plus breathing room, for anything we scroll into view. */
const NAV_OFFSET = 88;

const LENS_LABEL: Record<string, string> = {
  product: 'Product and Delivery',
  data: 'Data',
  marketing: 'Marketing',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One bubble for every `.term` (a technical term explained in a sentence) and
 * every `.ev` (a skill that links to where it was used). The text lives in the
 * element named by aria-describedby, so screen readers hear it on focus and the
 * bubble is only the visual copy.
 */
function initTips() {
  const triggers = Array.from(document.querySelectorAll<HTMLElement>('.term, .ev'));
  if (!triggers.length) return;

  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  const hint = document.createElement('span');
  hint.className = 'tip-h';
  tip.append(text, hint);
  document.body.appendChild(tip);

  let owner: HTMLElement | null = null;
  let lastPointer = 'mouse';
  let hideTimer = 0;

  const describe = (el: HTMLElement) =>
    document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent?.trim() ?? '';

  function place() {
    if (!owner) return;
    const r = owner.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, vw - w - 12));
    // Above the trigger unless that would slide under the fixed nav.
    const top = r.top - h - 10 < NAV_OFFSET - 16 ? r.bottom + 10 : r.top - h - 10;
    tip.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
  }

  function show(el: HTMLElement, touch: boolean) {
    window.clearTimeout(hideTimer);
    owner?.classList.remove('tip-on');
    owner = el;
    el.classList.add('tip-on');
    text.textContent = describe(el);
    hint.textContent = touch && el.classList.contains('ev') ? 'Tap again to see it' : '';
    tip.classList.add('on');
    place();
  }

  function hide() {
    window.clearTimeout(hideTimer);
    owner?.classList.remove('tip-on');
    owner = null;
    tip.classList.remove('on');
  }

  const hideSoon = () => { hideTimer = window.setTimeout(hide, 120); };

  document.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    if (owner && !(e.target as HTMLElement).closest?.('.term, .ev')) hide();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', () => { if (owner) place(); }, { passive: true });
  window.addEventListener('resize', hide);

  triggers.forEach((el) => {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(el, false); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideSoon(); });
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) show(el, false); });
    el.addEventListener('blur', hideSoon);

    el.addEventListener('click', (e) => {
      const keyboard = e.detail === 0;
      const touch = !keyboard && lastPointer !== 'mouse';
      const open = owner === el && tip.classList.contains('on');

      if (el.classList.contains('term')) {
        // A term only explains itself. Mouse users already see it on hover.
        if (keyboard || touch) { if (open) hide(); else show(el, touch); }
        return;
      }

      // Evidence link: on touch the first tap reads the line, the second goes there.
      e.preventDefault();
      if (touch && !open) { show(el, true); return; }
      hide();
      jumpTo(el.getAttribute('href') ?? '');
    });
  });
}

/** Scroll to the role or project behind a skill and light up the exact line. */
function jumpTo(hash: string) {
  const target = hash.startsWith('#') ? document.getElementById(hash.slice(1)) : null;
  if (!target) return;
  const block = target.closest<HTMLElement>('.job, .edu, .an-card') ?? target;
  const y = block.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
  const far = Math.abs(y - window.scrollY) > 4;
  window.scrollTo({ top: Math.max(0, y), behavior: reduceMotion ? 'auto' : 'smooth' });

  // Keyboard and screen reader users land where they asked to go.
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });

  // Hold the highlight until the scroll has landed, so a long jump still shows it.
  target.classList.add('flash');
  let landed = false;
  const fade = () => {
    if (landed) return;
    landed = true;
    window.removeEventListener('scrollend', fade);
    window.setTimeout(() => target.classList.remove('flash'), 1800);
  };
  if (!far || reduceMotion) { fade(); return; }
  window.addEventListener('scrollend', fade);
  window.setTimeout(fade, 1800); // browsers without scrollend
}

/**
 * "Highlight the evidence for": marks skills, experience points and projects
 * whose data-area matches, and dims the rest. "Everything" clears it.
 */
function initLens() {
  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="lens"]'));
  if (!radios.length) return;
  const status = $('lensStatus');
  const jump = $('lensJump');
  const items = Array.from(document.querySelectorAll<HTMLElement>('.fx'));
  const roles = Array.from(document.querySelectorAll<HTMLElement>('.job'));

  function apply(lens: string) {
    const on = lens in LENS_LABEL;
    let skills = 0, points = 0, projects = 0;

    items.forEach((el) => {
      const hit = on && (el.dataset.area ?? '').split(/\s+/).includes(lens);
      el.classList.toggle('fx-hit', hit);
      el.classList.toggle('fx-dim', on && !hit);
      if (!hit) return;
      if (el.classList.contains('skill')) skills++;
      else if (el.tagName === 'LI') points++;
      else projects++;
    });
    roles.forEach((r) => r.classList.toggle('fx-dim', on && !r.querySelector('.fx-hit')));

    if (status) {
      const parts = [
        skills && plural(skills, 'skill', 'skills'),
        points && plural(points, 'experience point', 'experience points'),
        projects && plural(projects, 'project', 'projects'),
      ].filter(Boolean) as string[];
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
      status.textContent = on
        ? `${LENS_LABEL[lens]}: ${list} highlighted. Everything else is dimmed.`
        : 'Showing everything.';
    }
    if (jump) jump.hidden = !on || points === 0;
  }

  radios.forEach((r) => r.addEventListener('change', () => { if (r.checked) apply(r.value); }));
  // A browser may restore the last choice on reload without firing change.
  const restored = radios.find((r) => r.checked);
  if (restored && restored.value !== 'all') apply(restored.value);
}

export function initEvidence() {
  initTips();
  initLens();
}
