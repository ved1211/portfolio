import './styles/tokens.css';
import './styles/chrome.css';
import './styles/layout.css';
import './styles/sections.css';
import './styles/motion.css';
import './styles/game.css';

import { $ } from './lib/env';
import { initTheme } from './lib/theme';
import { initBoot } from './lib/boot';
import { initCursor } from './lib/cursor';
import { initNav } from './lib/nav';
import { initScroll, initReveal, initPipelinePulse } from './lib/scroll';
import { initGreeter } from './lib/greeter';
import { initBackground } from './three/background';
import { initVoxelUI } from './three/voxel/ui';

initTheme();
initBoot();
initNav();
initCursor();
initScroll();
initReveal();
initPipelinePulse();

const field = $<HTMLCanvasElement>('field');
const bg = field ? initBackground(field) : undefined;

const voxel = initVoxelUI();
initGreeter(voxel.open);

// The lattice has no business rendering behind a full-screen 3D game.
const shell = $('bp');
if (shell && bg) {
  new MutationObserver(() => bg.setRunning(!shell.classList.contains('on')))
    .observe(shell, { attributes: true, attributeFilter: ['class'] });
}
