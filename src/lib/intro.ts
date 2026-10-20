import { $, reduceMotion } from './env';

const KEY = 'vg-intro';

/**
 * A cartoon Ved walks in from the right, says four short lines (about
 * 14 seconds), offers the work or the game, then waits in the corner.
 * It plays once a visit; the face in the corner replays it.
 */
export function initIntro(openGame: () => void) {
  const root = $('intro');
  const dock = $('dock');
  const ved = document.getElementById('ved') as SVGSVGElement | null;
  const say = $('intro-say');
  const live = $('intro-live');
  const btns = $('intro-btns');
  if (!root || !dock || !ved || !say || !btns) return;

  const lines = Array.from(document.querySelectorAll<HTMLElement>('#intro-script li')).map((li) => ({
    text: (li.textContent ?? '').trim(),
    final: li.hasAttribute('data-final'),
  }));

  // The corner button shows the same face, copied from the figure.
  const head = document.getElementById('ved-head');
  const face = dock.querySelector('.dock-face');
  if (head && face) {
    const copy = head.cloneNode(true) as Element;
    copy.removeAttribute('id');
    face.appendChild(copy);
  }

  let timers: number[] = [];
  let typing = 0;
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
  const stop = () => {
    timers.forEach((t) => window.clearTimeout(t));
    timers = [];
    window.clearInterval(typing);
  };

  function showDock() {
    dock!.hidden = false;
    requestAnimationFrame(() => dock!.classList.add('in'));
  }

  function end() {
    const hadFocus = root!.contains(document.activeElement);
    stop();
    root!.classList.remove('walking', 'talking', 'waving', 'speaking');
    root!.classList.add('leaving');
    later(() => { root!.hidden = true; root!.classList.remove('leaving'); }, reduceMotion ? 0 : 420);
    try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    showDock();
    if (hadFocus) $('dock-replay')?.focus();
  }

  function speak(i: number) {
    const line = lines[i];
    if (!line) { end(); return; }
    if (live) live.textContent = line.text;      // screen readers hear each line once, whole
    btns!.hidden = !line.final;
    root!.classList.add('speaking');
    if (i === 0 && !reduceMotion) {
      root!.classList.add('waving');
      later(() => root!.classList.remove('waving'), 1700);
    }
    if (reduceMotion) {
      say!.textContent = line.text;
    } else {
      let n = 0;
      say!.textContent = '';
      root!.classList.add('talking');
      typing = window.setInterval(() => {
        n++;
        say!.textContent = line.text.slice(0, n);
        if (n >= line.text.length) { window.clearInterval(typing); root!.classList.remove('talking'); }
      }, 24);
    }
    // Long enough to read: one second plus about 42 ms a character.
    const hold = line.final ? 12000 : Math.min(4400, 1000 + line.text.length * 42);
    later(() => (line.final ? end() : speak(i + 1)), hold);
  }

  function play() {
    stop();
    dock!.classList.remove('in');
    dock!.hidden = true;
    root!.classList.remove('leaving', 'speaking');
    root!.hidden = false;
    say!.textContent = '';
    btns!.hidden = true;
    if (reduceMotion) { later(() => speak(0), 300); return; }
    // Start off-screen to the right and walk to the resting spot.
    const from = Math.min(window.innerWidth * 0.45, 560);
    ved!.style.transition = 'none';
    ved!.style.transform = `translateX(${from}px)`;
    void ved!.getBoundingClientRect();
    ved!.style.transition = '';
    root!.classList.add('walking');
    ved!.style.transform = 'translateX(0)';
    later(() => { root!.classList.remove('walking'); speak(0); }, 2000);
  }

  $('intro-skip')?.addEventListener('click', end);
  $('intro-work')?.addEventListener('click', () => {
    end();
    document.getElementById('work')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  $('intro-play')?.addEventListener('click', () => { end(); openGame(); });
  $('dock-replay')?.addEventListener('click', play);
  $('dock-play')?.addEventListener('click', openGame);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) end(); });

  let seen = false;
  try { seen = sessionStorage.getItem(KEY) === '1'; } catch { /* private mode */ }
  const start = () => (seen ? showDock() : later(play, reduceMotion ? 400 : 1500));

  // Wait for the loading screen to lift and the headline to land.
  if (document.body.classList.contains('loaded')) start();
  else {
    const mo = new MutationObserver(() => {
      if (!document.body.classList.contains('loaded')) return;
      mo.disconnect();
      start();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
}
