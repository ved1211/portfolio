import { $, debounce } from './env';

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
