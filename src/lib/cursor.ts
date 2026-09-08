import { $, finePointer, reduceMotion } from './env';

export function initCursor() {
  if (!finePointer || reduceMotion) return;
  const ring = $('cur');
  const dot = $('cur-dot');
  let mx = 0, my = 0, rx = 0, ry = 0;

  window.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    document.body.classList.add('has-cursor');
    if (dot) dot.style.transform = `translate(${mx}px,${my}px)`;
  }, { passive: true });

  const loop = () => {
    rx += (mx - rx) * 0.16;
    ry += (my - ry) * 0.16;
    if (ring) ring.style.transform = `translate(${rx.toFixed(2)}px,${ry.toFixed(2)}px)`;
    requestAnimationFrame(loop);
  };
  loop();

  document.addEventListener('mouseover', (e) => {
    const t = e.target as HTMLElement | null;
    const hot = !!t?.closest?.('a, button, .sys, .case, .skill, .crow');
    document.body.classList.toggle('cur-hot', hot);
  });
}
