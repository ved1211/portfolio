import { $ } from '../../lib/env';
import { createVoxelGame, VoxelGame } from './game';
import { Material, PALETTE } from './blueprint';

export function initVoxelUI() {
  const shell = $('bp');
  const canvas = $<HTMLCanvasElement>('bp-canvas');
  const msg = $('bp-msg');
  const bar = $('bp-bar');
  const pct = $('bp-pct');
  const rw = $('bp-rework');
  const hotbar = $('bp-hotbar');
  if (!shell || !canvas || !hotbar) return { open: () => {}, isOpen: () => false };

  let game: VoxelGame | null = null;
  let lastFocus: Element | null = null;

  // hotbar
  (Object.keys(PALETTE) as Material[]).forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bp-slot' + (i === 0 ? ' on' : '');
    b.dataset.mat = m;
    b.innerHTML =
      `<i style="background:#${PALETTE[m].hex.toString(16).padStart(6, '0')}"></i>` +
      `<span>${PALETTE[m].label}</span><kbd>${PALETTE[m].key}</kbd>`;
    hotbar.appendChild(b);
  });

  function select(m: Material) {
    game?.setMaterial(m);
    hotbar!.querySelectorAll('.bp-slot').forEach((el) =>
      el.classList.toggle('on', (el as HTMLElement).dataset.mat === m));
  }

  hotbar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.bp-slot');
    if (b?.dataset.mat) select(b.dataset.mat as Material);
  });

  function ensure() {
    if (game) return game;
    game = createVoxelGame(canvas!);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__voxel = game;
    game.onMessage((text, bad) => {
      if (!msg) return;
      msg.textContent = text;
      msg.classList.toggle('bad', bad);
    });
    game.onProgress((p, r, done) => {
      if (bar) bar.style.transform = `scaleX(${(p / 100).toFixed(3)})`;
      if (pct) pct.textContent = `${p}%`;
      if (rw) rw.textContent = `REWORK ${r}`;
      shell!.classList.toggle('done', done);
    });
    return game;
  }

  function open() {
    lastFocus = document.activeElement;
    shell!.classList.add('on');
    document.body.style.overflow = 'hidden';
    const g = ensure();
    g.mount();
    g.reset();
    select('stone');
    (shell!.querySelector('.bp-slot') as HTMLElement | null)?.focus();
  }

  function close() {
    shell!.classList.remove('on');
    document.body.style.overflow = '';
    game?.unmount();
    (lastFocus as HTMLElement | null)?.focus?.();
  }

  shell.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-bp-close]')) close();
  });
  $('bp-reset')?.addEventListener('click', () => game?.reset());
  $('bp-auto')?.addEventListener('click', () => game?.autoBuild());

  document.addEventListener('keydown', (e) => {
    if (!shell!.classList.contains('on')) return;
    if (e.key === 'Escape') { close(); return; }
    const hit = (Object.keys(PALETTE) as Material[]).find((m) => PALETTE[m].key === e.key);
    if (hit) select(hit);
  });

  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[href="#play"]');
    if (a) { e.preventDefault(); open(); }
  });

  return { open, isOpen: () => shell!.classList.contains('on') };
}
