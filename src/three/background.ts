import {
  AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Fog, InstancedMesh,
  LineBasicMaterial, LineSegments, Matrix4, PerspectiveCamera, Points, PointsMaterial,
  Scene, SphereGeometry, MeshBasicMaterial, WebGLRenderer,
} from 'three';
import { cssColor, reduceMotion } from '../lib/env';
import { isDark, onThemeChange } from '../lib/theme';

/**
 * An orthogonal lattice drifting in depth, with signal pulses running the edges.
 * The 2D flow field this replaces said "pipelines"; this says the same thing
 * with parallax, so it reads as depth rather than decoration.
 */

const SPAN_X = 46, SPAN_Y = 26, SPAN_Z = 24;
const COLS = 15, ROWS = 9, LAYERS = 4;
const PULSES = 30;

type Edge = { ax: number; ay: number; az: number; bx: number; by: number; bz: number };

export function initBackground(canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return; // no WebGL: the page is fully readable without it
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(52, 1, 0.1, 160);
  camera.position.set(0, 0, 54);

  // ── lattice ────────────────────────────────────────────
  const nodes: number[] = [];
  const grid: (number[] | null)[][][] = [];
  for (let z = 0; z < LAYERS; z++) {
    grid[z] = [];
    for (let y = 0; y < ROWS; y++) {
      grid[z][y] = [];
      for (let x = 0; x < COLS; x++) {
        // A sparse lattice reads as a network; a full one reads as wallpaper.
        if (Math.random() < 0.34) { grid[z][y][x] = null; continue; }
        const p = [
          (x / (COLS - 1) - 0.5) * SPAN_X + (Math.random() - 0.5) * 1.1,
          (y / (ROWS - 1) - 0.5) * SPAN_Y + (Math.random() - 0.5) * 1.1,
          (z / (LAYERS - 1) - 0.5) * SPAN_Z,
        ];
        grid[z][y][x] = p;
        nodes.push(p[0], p[1], p[2]);
      }
    }
  }

  const edges: Edge[] = [];
  const linePos: number[] = [];
  for (let z = 0; z < LAYERS; z++)
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const a = grid[z][y][x];
        if (!a) continue;
        const right = x + 1 < COLS ? grid[z][y][x + 1] : null;
        const up = y + 1 < ROWS ? grid[z][y + 1][x] : null;
        for (const b of [right, up]) {
          if (!b) continue;
          linePos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          edges.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
        }
      }

  const nodeGeo = new BufferGeometry();
  nodeGeo.setAttribute('position', new Float32BufferAttribute(nodes, 3));
  const nodeMat = new PointsMaterial({ size: 0.26, transparent: true, opacity: 0.34, depthWrite: false });
  scene.add(new Points(nodeGeo, nodeMat));

  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new Float32BufferAttribute(linePos, 3));
  const lineMat = new LineBasicMaterial({ transparent: true, opacity: 0.09 });
  scene.add(new LineSegments(lineGeo, lineMat));

  // ── pulses ─────────────────────────────────────────────
  const pulseMat = new MeshBasicMaterial({ transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false });
  const pulses = new InstancedMesh(new SphereGeometry(0.13, 8, 8), pulseMat, PULSES);
  scene.add(pulses);

  const state = Array.from({ length: PULSES }, () => ({
    edge: (Math.random() * edges.length) | 0,
    t: Math.random(),
    speed: 0.14 + Math.random() * 0.3,
  }));
  const m = new Matrix4();

  // ── colours follow the theme ───────────────────────────
  function paint() {
    const dark = isDark();
    const ink = new Color(cssColor('--ink', '#151815'));
    nodeMat.color = ink;
    lineMat.color = ink;
    pulseMat.color = new Color(cssColor('--signal', '#0F7A52'));
    nodeMat.opacity = dark ? 0.34 : 0.3;
    lineMat.opacity = dark ? 0.1 : 0.09;
    scene.fog = new Fog(new Color(cssColor('--paper', '#F4F5F2')), 30, 86);
  }
  paint();
  onThemeChange(paint);

  // ── input ──────────────────────────────────────────────
  let mx = 0, my = 0, cx = 0, cy = 0, scrollY = 0;
  addEventListener('pointermove', (e) => {
    mx = (e.clientX / innerWidth - 0.5) * 2;
    my = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });
  addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

  function resize() {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return; // loaded into a zero-sized (hidden) viewport
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();
  addEventListener('resize', resize);
  addEventListener('load', resize);

  // ── loop ───────────────────────────────────────────────
  let raf = 0, running = true, last = performance.now();

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    cx += (mx * 3.2 - cx) * 0.035;
    cy += (my * 2.0 - cy) * 0.035;
    camera.position.x = cx;
    camera.position.y = -cy - scrollY * 0.004;
    camera.position.z = 54 - scrollY * 0.0016;
    camera.lookAt(0, -scrollY * 0.002, 0);

    for (let i = 0; i < PULSES; i++) {
      const s = state[i];
      s.t += s.speed * dt;
      if (s.t > 1) { s.t = 0; s.edge = (Math.random() * edges.length) | 0; }
      const e = edges[s.edge];
      if (!e) continue;
      m.makeTranslation(
        e.ax + (e.bx - e.ax) * s.t,
        e.ay + (e.by - e.ay) * s.t,
        e.az + (e.bz - e.az) * s.t,
      );
      pulses.setMatrixAt(i, m);
    }
    pulses.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }

  if (reduceMotion) {
    renderer.render(scene, camera); // one static frame, no loop
  } else {
    raf = requestAnimationFrame(frame);
  }

  // Don't burn battery in a hidden tab or behind the game.
  const setRunning = (on: boolean) => {
    if (reduceMotion || on === running) return;
    running = on;
    if (on) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else cancelAnimationFrame(raf);
  };
  document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
  return { setRunning };
}
