import './styles/tokens.css';
import './styles/chrome.css';
import './styles/layout.css';
import './styles/sections.css';
import './styles/motion.css';
import './styles/game.css';
import './styles/evidence.css';
import './styles/intro.css';

import { $ } from './lib/env';
import { initTheme } from './lib/theme';
import { initBoot } from './lib/boot';
import { initCursor } from './lib/cursor';
import { initNav } from './lib/nav';
import { initScroll, initReveal } from './lib/scroll';
import { initIntro } from './lib/intro';
import { initEvidence } from './lib/evidence';
import { initBackground } from './three/background';
import { initVoxelUI } from './three/voxel/ui';

initTheme();
initBoot();
initNav();
initCursor();
initScroll();
initReveal();
initEvidence();

/**
 * The dotted background: 'dim' draws a faint lattice, 'off' leaves the page
 * plain. Change the default here; ?bg=dim or ?bg=off in the URL previews either.
 */
const BACKGROUND_DEFAULT: 'dim' | 'off' = 'dim';
const bgParam = new URLSearchParams(location.search).get('bg');
const background = bgParam === 'dim' || bgParam === 'off' ? bgParam : BACKGROUND_DEFAULT;

const field = $<HTMLCanvasElement>('field');
if (field && background === 'off') field.remove();
const bg = field && background === 'dim' ? initBackground(field) : undefined;

const voxel = initVoxelUI();
initIntro(voxel.open);

// The lattice has no business rendering behind a full-screen 3D game.
const shell = $('bp');
if (shell && bg) {
  new MutationObserver(() => bg.setRunning(!shell.classList.contains('on')))
    .observe(shell, { attributes: true, attributeFilter: ['class'] });
}
