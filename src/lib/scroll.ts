import { $, debounce, reduceMotion } from './env';

export function initScroll() {
  const nav = $('nav');

  function onScroll() {
    nav?.classList.toggle('stuck', window.scrollY > 8);
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

/**
 * A short fade for blocks below the fold. Content is visible by default: CSS
 * only hides a .rv block once html.rv-on is set, which happens here, after
 * everything already on screen is marked shown. No script, no hiding.
 */
export function initReveal() {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.rv'));
  if (!items.length || reduceMotion || !('IntersectionObserver' in window)) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px 10% 0px' }); // any pixel, slightly before it scrolls in

  const vh = window.innerHeight;
  items.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) el.classList.add('in');
    else io.observe(el);
  });
  document.documentElement.classList.add('rv-on');

  // A nav link or #hash jump shows its whole section at once, before the scroll lands.
  const showSection = (hash: string) => {
    const target = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    target?.closest('section, header')?.querySelectorAll('.rv').forEach((el) => el.classList.add('in'));
  };
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.<HTMLAnchorElement>('a[href^="#"]');
    if (a) showSection(a.getAttribute('href') ?? '');
  }, true);
  window.addEventListener('hashchange', () => showSection(location.hash));
  showSection(location.hash);
}
