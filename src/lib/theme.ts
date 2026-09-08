import { $ } from './env';

type Listener = (dark: boolean) => void;
const listeners: Listener[] = [];
let dark = document.documentElement.classList.contains('dark');

export const isDark = () => dark;
export const onThemeChange = (fn: Listener) => { listeners.push(fn); };

function paint() {
  document.documentElement.classList.toggle('dark', dark);
  const icon = $('togIcon');
  if (icon) icon.textContent = dark ? '☀' : '☾';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#131210' : '#F4F1EA');
  listeners.forEach((fn) => fn(dark));
}

export function initTheme() {
  $('tog')?.addEventListener('click', () => {
    dark = !dark;
    try { localStorage.setItem('vg-theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
    paint();
  });
  paint();
}
