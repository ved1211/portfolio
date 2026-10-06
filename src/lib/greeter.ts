import { $, reduceMotion } from './env';

export function initGreeter(openGame: () => void) {
  const greet = $('greet');
  const mini = $('greet-mini');
  if (!greet) return;

  let seen = false;
  try { seen = sessionStorage.getItem('vg-greet') === '1'; } catch { /* private mode */ }

  // The greeter only speaks once a session; after that the game lives in the corner.
  const showMini = () => {
    if (!mini) return;
    mini.hidden = false;
    requestAnimationFrame(() => mini.classList.add('in'));
  };

  const hide = () => {
    greet.classList.remove('in');
    window.setTimeout(() => { greet.hidden = true; showMini(); }, 500);
    try { sessionStorage.setItem('vg-greet', '1'); } catch { /* private mode */ }
  };

  window.setTimeout(() => {
    if (seen) { showMini(); return; }
    greet.hidden = false;
    requestAnimationFrame(() => greet.classList.add('in'));
  }, reduceMotion ? 400 : seen ? 1200 : 2200);

  $('greet-x')?.addEventListener('click', hide);
  $('greet-work')?.addEventListener('click', hide);
  $('greet-play')?.addEventListener('click', () => { hide(); openGame(); });
  mini?.addEventListener('click', openGame);
}
