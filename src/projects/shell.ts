import '../styles/tokens.css';
import '../styles/chrome.css';
import '../styles/layout.css';
import '../styles/sections.css';
import '../styles/motion.css';
import '../styles/project.css';

import { $ } from '../lib/env';
import { initTheme } from '../lib/theme';
import { initCursor } from '../lib/cursor';
import { initReveal } from '../lib/scroll';

/** The parts every case study page shares with the home page. */
export function initProjectShell() {
  initTheme();
  initCursor();
  initReveal();
  document.body.classList.add('loaded');
  const nav = $('nav');
  const onScroll = () => nav?.classList.toggle('stuck', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
