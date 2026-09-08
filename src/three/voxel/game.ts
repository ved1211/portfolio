import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, EdgesGeometry, Fog, GridHelper,
  LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane,
  Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { cssColor, reduceMotion } from '../../lib/env';
import { isDark, onThemeChange } from '../../lib/theme';
import { buildPlan, key, Material, PALETTE, REASONS, SIZE } from './blueprint';

const CELL = 1;
const half = (SIZE - 1) / 2;
const toWorld = (x: number, y: number, z: number) =>
  new Vector3((x - half) * CELL, y * CELL + CELL / 2, (z - half) * CELL);

export interface VoxelGame {
  mount(): void;
  unmount(): void;
  reset(): void;
  autoBuild(): void;
  setMaterial(m: Material): void;
  onProgress(fn: (pct: number, rework: number, done: boolean) => void): void;
  onMessage(fn: (text: string, bad: boolean) => void): void;
  /** dev only: lets the browser console drive a real placement */
  debugTap?(clientX: number, clientY: number, erase?: boolean): unknown;
}

export function createVoxelGame(canvas: HTMLCanvasElement): VoxelGame {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(46, 1, 0.1, 120);

  const plan = buildPlan();
  const placed = new Map<string, Mesh>();
  let rework = 0;
  let selected: Material = 'stone';
  let progressCb: ((p: number, r: number, d: boolean) => void) | null = null;
  let messageCb: ((t: string, bad: boolean) => void) | null = null;

  // ── lighting + ground ──────────────────────────────────
  scene.add(new AmbientLight(0xffffff, 0.72));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 12, 8);
  scene.add(sun);
  const rim = new DirectionalLight(new Color(cssColor('--signal', '#A15C10')), 0.35);
  rim.position.set(-8, 4, -6);
  scene.add(rim);

  const grid = new GridHelper(SIZE + 4, SIZE + 4);
  grid.position.y = 0.001;
  scene.add(grid);

  // Mathematical ground: mesh raycasting against an invisible material is
  // fragile, and this also lets us reject clicks outside the footprint.
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const groundHit = new Vector3();

  // ── blueprint ghost ────────────────────────────────────
  const ghostGeo = new EdgesGeometry(new BoxGeometry(CELL, CELL, CELL));
  const ghostMat = new LineBasicMaterial({ transparent: true, opacity: 0.28 });
  const ghosts = new Map<string, LineSegments>();
  plan.forEach((_m, k) => {
    const [x, y, z] = k.split(',').map(Number);
    const g = new LineSegments(ghostGeo, ghostMat);
    g.position.copy(toWorld(x, y, z));
    ghosts.set(k, g);
    scene.add(g);
  });

  const boxGeo = new BoxGeometry(CELL * 0.98, CELL * 0.98, CELL * 0.98);
  const mats: Record<Material, MeshStandardMaterial> = {
    stone: new MeshStandardMaterial({ color: PALETTE.stone.hex, roughness: 0.95 }),
    wood:  new MeshStandardMaterial({ color: PALETTE.wood.hex,  roughness: 0.8 }),
    glass: new MeshStandardMaterial({ color: PALETTE.glass.hex, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55 }),
    slate: new MeshStandardMaterial({ color: PALETTE.slate.hex, roughness: 0.7 }),
  };

  function paintTheme() {
    const dark = isDark();
    const ink = new Color(cssColor('--ink', '#131C17'));
    scene.fog = new Fog(new Color(cssColor('--paper-2', '#E4EAE2')), 14, 40);
    ghostMat.color = ink;
    const gm = grid.material as LineBasicMaterial;
    gm.transparent = true;
    gm.opacity = dark ? 0.18 : 0.25;
    gm.color = ink;
  }
  paintTheme();
  onThemeChange(paintTheme);

  // ── camera orbit ───────────────────────────────────────
  let theta = Math.PI * 0.25, phi = Math.PI * 0.32, dist = 12;
  let dragging = false, moved = false, lx = 0, ly = 0;

  function placeCamera() {
    camera.position.set(
      dist * Math.sin(phi) * Math.cos(theta),
      dist * Math.cos(phi),
      dist * Math.sin(phi) * Math.sin(theta),
    );
    camera.lookAt(0, 1.4, 0);
    // Raycasting reads matrixWorld, which render() would otherwise be the only
    // thing to refresh. Keep it current so a click right after a move is right.
    camera.updateMatrixWorld();
  }
  placeCamera();

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    theta -= dx * 0.008;
    phi = Math.min(Math.PI * 0.49, Math.max(0.12, phi - dy * 0.006));
    lx = e.clientX; ly = e.clientY;
    placeCamera();
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
    if (!moved) click(e, e.shiftKey || e.button === 2);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    dist = Math.min(24, Math.max(6, dist + Math.sign(e.deltaY) * 0.9));
    placeCamera();
  }, { passive: false });

  // ── placing ────────────────────────────────────────────
  const ray = new Raycaster();
  const ndc = new Vector2();

  function cellOf(mesh: Mesh): [number, number, number] {
    const k = mesh.userData.cell as string;
    return k.split(',').map(Number) as [number, number, number];
  }

  function supported(x: number, y: number, z: number) {
    if (y === 0) return true;
    if (placed.has(key(x, y - 1, z))) return true;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => placed.has(key(x + dx, y, z + dz)));
  }

  function say(text: string, bad = false) { messageCb?.(text, bad); }

  function report() {
    let correct = 0;
    placed.forEach((_m, k) => { if (plan.has(k)) correct++; });
    const pct = Math.round((correct / plan.size) * 100);
    progressCb?.(pct, rework, correct === plan.size);
    if (correct === plan.size) {
      say(rework === 0
        ? 'Built to plan, zero rework. That is the whole pitch.'
        : `Built, with ${rework} rework${rework > 1 ? 's' : ''}. Every one of those is a real week somewhere.`);
    }
  }

  function place(x: number, y: number, z: number) {
    const k = key(x, y, z);
    if (placed.has(k)) return;
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 0 || y > 5) return;

    const want = plan.get(k);
    if (!want) { rework++; say(REASONS.outsidePlan, true); report(); return; }
    if (!supported(x, y, z)) { rework++; say(REASONS.unsupported, true); report(); return; }
    if (want !== selected) { rework++; say(REASONS.wrongMaterial(want), true); report(); return; }

    const mesh = new Mesh(boxGeo, mats[selected]);
    mesh.position.copy(toWorld(x, y, z));
    mesh.userData.cell = k;
    scene.add(mesh);
    placed.set(k, mesh);
    ghosts.get(k)!.visible = false;
    say('');
    report();
  }

  function remove(k: string) {
    const mesh = placed.get(k);
    if (!mesh) return;
    scene.remove(mesh);
    placed.delete(k);
    const g = ghosts.get(k);
    if (g) g.visible = true;
    report();
  }

  function click(e: PointerEvent, erase: boolean) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);

    const hit = ray.intersectObjects([...placed.values()], false)[0];

    if (!hit) {
      if (erase) return;
      if (!ray.ray.intersectPlane(groundPlane, groundHit)) return;
      place(Math.round(groundHit.x / CELL + half), 0, Math.round(groundHit.z / CELL + half));
      return;
    }

    const [x, y, z] = cellOf(hit.object as Mesh);
    if (erase) { remove(key(x, y, z)); return; }
    const n = hit.face?.normal ?? new Vector3(0, 1, 0);
    place(x + Math.round(n.x), y + Math.round(n.y), z + Math.round(n.z));
  }

  // ── loop ───────────────────────────────────────────────
  let raf = 0, live = false;
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    renderer.setSize(r.width, r.height, false);
  }
  function frame() {
    if (!dragging && !reduceMotion) { theta += 0.0009; placeCamera(); }
    renderer.render(scene, camera);
    if (live) raf = requestAnimationFrame(frame);
  }

  return {
    mount() {
      live = true;
      paintTheme();
      resize();
      addEventListener('resize', resize);
      raf = requestAnimationFrame(frame);
      report();
    },
    unmount() {
      live = false;
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
    },
    reset() {
      placed.forEach((m) => scene.remove(m));
      placed.clear();
      ghosts.forEach((g) => { g.visible = true; });
      rework = 0;
      say('Start at the bottom. Nothing floats.');
      report();
    },
    autoBuild() {
      [...plan.keys()]
        .sort((a, b) => Number(a.split(',')[1]) - Number(b.split(',')[1]))
        .forEach((k) => {
          if (placed.has(k)) return;
          const [x, y, z] = k.split(',').map(Number);
          const mesh = new Mesh(boxGeo, mats[plan.get(k)!]);
          mesh.position.copy(toWorld(x, y, z));
          mesh.userData.cell = k;
          scene.add(mesh);
          placed.set(k, mesh);
          ghosts.get(k)!.visible = false;
        });
      say('Fine, I built it. This is the part I automate anyway.');
      report();
    },
    setMaterial(m) { selected = m; },
    debugTap(clientX, clientY, erase = false) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([...placed.values()], false)[0];
      const onPlane = ray.ray.intersectPlane(groundPlane, groundHit);
      const info = {
        ndc: [ndc.x, ndc.y],
        camera: camera.position.toArray().map((n) => +n.toFixed(2)),
        hitMesh: hit ? (hit.object as Mesh).userData.cell : null,
        planePoint: onPlane ? groundHit.toArray().map((n) => +n.toFixed(2)) : null,
        cell: onPlane ? [Math.round(groundHit.x / CELL + half), 0, Math.round(groundHit.z / CELL + half)] : null,
        placedCount: placed.size,
        selected,
      };
      click({ clientX, clientY, shiftKey: erase, button: 0 } as PointerEvent, erase);
      return { ...info, placedAfter: placed.size };
    },
    onProgress(fn) { progressCb = fn; },
    onMessage(fn) { messageCb = fn; },
  };
}
