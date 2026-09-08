import { $, reduceMotion } from './env';

export function initBoot() {
  const boot = $('boot');
  let seen = false;
  try { seen = sessionStorage.getItem('vg-seen') === '1'; } catch { /* private mode */ }

  if (reduceMotion || seen) {
    boot?.remove();
    document.body.classList.add('loaded');
    return;
  }
  try { sessionStorage.setItem('vg-seen', '1'); } catch { /* private mode */ }
  window.setTimeout(() => {
    document.body.classList.add('loaded');
    if (!boot) return;
    boot.classList.add('done');
    window.setTimeout(() => boot.remove(), 1200);
  }, 1000);
}
