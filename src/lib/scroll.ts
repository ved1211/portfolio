import { $, debounce, reduceMotion } from './env';

/** Normalised page scroll, published for the 3D background. */
export let scrollProgress = 0;

const SECTION_IDS = ['hero', 'work', 'systems', 'experience', 'about', 'education', 'contact'];

export function initScroll() {
  const nav = $('nav');
  const hOuter = $('hOuter');
  const hRail = $('hRail');
  const hFill = $('hFill');
  const spineFill = $('spineFill');
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.spine-node'));
  const body = document.body;
  let hSpan = 0;

  function measure() {
    if (!hOuter || !hRail) return;
    if (window.innerWidth <= 1024) {
      hOuter.style.height = '';
      hRail.style.transform = '';
      hSpan = 0;
      return;
    }
    hRail.style.transform = 'none';
    const last = hRail.children[hRail.children.length - 1] as HTMLElement | undefined;
    const overhang = last ? last.getBoundingClientRect().right - window.innerWidth : 0;
    hSpan = Math.max(0, overhang + 48);
    hOuter.style.height = `${window.innerHeight + hSpan}px`;
  }

  function onScroll() {
    const y = window.scrollY;
    nav?.classList.toggle('stuck', y > 8);

    // Horizontal rail. #systems is positioned, so offsetTop reads 0 here;
    // measure against the document instead.
    if (hOuter && hRail && hSpan > 0) {
      const top = hOuter.getBoundingClientRect().top + y;
      const prog = Math.min(1, Math.max(0, (y - top) / hSpan));
      hRail.style.transform = `translate3d(${-hSpan * prog}px,0,0)`;
      if (hFill) hFill.style.transform = `scaleX(${prog.toFixed(4)})`;
      // The spine would otherwise sit on top of the sliding cards.
      body.classList.toggle('rail-pinned', prog > 0.001 && prog < 0.999);
    } else {
      body.classList.remove('rail-pinned');
    }

    const docH = document.documentElement.scrollHeight - window.innerHeight;
    scrollProgress = docH > 0 ? Math.min(1, Math.max(0, y / docH)) : 0;
    if (spineFill) spineFill.style.height = `${(nodes.length - 1) * 35 * scrollProgress}px`;

    const mid = y + window.innerHeight * 0.4;
    let active = 0;
    SECTION_IDS.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top + y <= mid) active = i;
    });
    nodes.forEach((n, i) => {
      n.classList.toggle('on', i === active);
      n.classList.toggle('past', i < active);
    });
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { onScroll(); ticking = false; });
  }, { passive: true });

  window.addEventListener('resize', debounce(() => { measure(); onScroll(); }, 180));
  window.addEventListener('load', () => { measure(); onScroll(); });
  measure();
  onScroll();
}

function countUp(el: HTMLElement) {
  const target = parseFloat(el.dataset.count ?? '');
  const prefix = el.dataset.prefix ?? '';
  if (Number.isNaN(target)) return;
  if (reduceMotion) { el.textContent = prefix + target; return; }
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / 1100);
    el.textContent = prefix + Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initReveal() {
  const items = document.querySelectorAll<HTMLElement>('.rv');

  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    document.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target as HTMLElement;
      const sibs = Array.from(el.parentElement?.children ?? [])
        .filter((n) => n.classList.contains('rv'));
      const idx = Math.min(sibs.indexOf(el), 5);
      el.style.transitionDelay = `${idx > 0 ? idx * 0.07 : 0}s`;
      el.classList.add('in');
      el.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
      io.unobserve(el);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

  items.forEach((el) => io.observe(el));
}

export function initPipelinePulse() {
  const steps = document.querySelectorAll<HTMLElement>('#pipe .pipe-step');
  if (!steps.length || reduceMotion) return;
  let i = 0;
  window.setInterval(() => {
    steps.forEach((s, n) => s.classList.toggle('hot', n === i));
    i = (i + 1) % (steps.length + 1);
  }, 900);
}
