export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

export function debounce<F extends (...a: never[]) => void>(fn: F, ms: number) {
  let t: number | undefined;
  return (...a: Parameters<F>) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
}

/** Read a CSS custom property off :root as an "r,g,b" triple. */
export function readRGB(name: string, fallback: [number, number, number]): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(',').map((n) => parseFloat(n));
  return parts.length === 3 && parts.every((n) => !Number.isNaN(n))
    ? (parts as [number, number, number])
    : fallback;
}

/** Read a CSS custom property as a colour string usable by three.js. */
export function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
