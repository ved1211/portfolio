import { $, debounce } from './env';

/** Normalised page scroll, published for the 3D background. */
export let scrollProgress = 0;

const SECTION_IDS = ['hero', 'work', 'analysis', 'experience', 'about', 'education', 'contact'];

export function initScroll() {
  const nav = $('nav');
  const spineFill = $('spineFill');
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.spine-node'));

  function onScroll() {
    const y = window.scrollY;
    nav?.classList.toggle('stuck', y > 8);

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

  window.addEventListener('resize', debounce(onScroll, 180));
  window.addEventListener('load', onScroll);
  onScroll();
}

export function initReveal() {
  const items = document.querySelectorAll<HTMLElement>('.rv');

  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
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
      io.unobserve(el);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

  items.forEach((el) => io.observe(el));
}
