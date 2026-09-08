export type Material = 'stone' | 'wood' | 'glass' | 'slate';

export const PALETTE: Record<Material, { hex: number; label: string; key: string }> = {
  stone: { hex: 0x8d8578, label: 'Foundation', key: '1' },
  wood:  { hex: 0xb2703c, label: 'Frame',      key: '2' },
  glass: { hex: 0x8fc3d6, label: 'Window',     key: '3' },
  slate: { hex: 0x4a4f57, label: 'Roof',       key: '4' },
};

export const SIZE = 5;          // footprint, in blocks
export const GROUND_Y = 0;

export const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** The plan the player is building to: cell -> required material. */
export function buildPlan(): Map<string, Material> {
  const plan = new Map<string, Material>();
  const max = SIZE - 1;

  // slab
  for (let x = 0; x < SIZE; x++)
    for (let z = 0; z < SIZE; z++) plan.set(key(x, 0, z), 'stone');

  // two courses of wall, with a window on each face and a doorway at the front
  for (let y = 1; y <= 2; y++)
    for (let x = 0; x < SIZE; x++)
      for (let z = 0; z < SIZE; z++) {
        const edge = x === 0 || z === 0 || x === max || z === max;
        if (!edge) continue;
        const mid = x === 2 || z === 2;
        const doorway = y === 1 && z === max && x === 2;
        if (doorway) continue;                       // left open on purpose
        plan.set(key(x, y, z), mid && y === 2 ? 'glass' : 'wood');
      }

  // roof, stepped so it reads as a house rather than a crate
  for (let x = 0; x < SIZE; x++)
    for (let z = 0; z < SIZE; z++) plan.set(key(x, 3, z), 'slate');
  for (let x = 1; x < SIZE - 1; x++)
    for (let z = 1; z < SIZE - 1; z++) plan.set(key(x, 4, z), 'slate');
  plan.set(key(2, 5, 2), 'slate');

  return plan;
}

/** Reasons a placement is rework, in the language of the job. */
export const REASONS = {
  unsupported: 'Nothing holding that up. Build on what already stands.',
  wrongMaterial: (want: Material) =>
    `The plan calls for ${PALETTE[want].label.toLowerCase()} there. Read it before you pour.`,
  outsidePlan: 'That is not on the plan. Scope you add is scope someone maintains.',
} as const;
