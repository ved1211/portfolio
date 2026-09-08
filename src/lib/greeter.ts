import { $, reduceMotion } from './env';

export function initGreeter(openGame: () => void) {
  const greet = $('greet');
  if (!greet) return;

  let seen = false;
  try { seen = sessionStorage.getItem('vg-greet') === '1'; } catch { /* private mode */ }

  const hide = () => {
    greet.classList.remove('in');
    window.setTimeout(() => { greet.hidden = true; }, 500);
    try { sessionStorage.setItem('vg-greet', '1'); } catch { /* private mode */ }
  };

  if (!seen) {
    window.setTimeout(() => {
      greet.hidden = false;
      requestAnimationFrame(() => greet.classList.add('in'));
    }, reduceMotion ? 400 : 2200);
  }

  $('greet-x')?.addEventListener('click', hide);
  $('greet-work')?.addEventListener('click', hide);
  $('greet-play')?.addEventListener('click', () => { hide(); openGame(); });
}
