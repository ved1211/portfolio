import { $ } from './env';

export function initNav() {
  const ham = $('ham');
  const mob = $('mob');
  if (!ham || !mob) return;

  const set = (open: boolean) => {
    ham.classList.toggle('open', open);
    mob.classList.toggle('open', open);
    ham.setAttribute('aria-expanded', String(open));
  };

  ham.addEventListener('click', () => set(!mob.classList.contains('open')));
  mob.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'A') set(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
}
