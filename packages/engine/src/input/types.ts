/**
 * InputFrame — the only source of non-determinism allowed each tick.
 * button bits: 0=forward, 1=back, 2=left, 3=right, 4=jump, 5=interact.
 * yaw: integer 0–255 mapping to 0–360 degrees via a precomputed LUT.
 */
export interface InputFrame {
  readonly buttons: number; // bitmask, 8 bits used
  readonly yaw: number; // 0–255
}

export const BUTTON = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  INTERACT: 1 << 5,
} as const;

/**
 * Precomputed sin/cos table indexed by quantized yaw (0–255).
 * Built from + − × ÷ only (IEEE-exact everywhere), not Math.sin, whose last bit
 * differs between JS engines. Quarter-wave symmetry keeps the table exact.
 */
export const YAW_SIN: Float64Array = new Float64Array(256);
export const YAW_COS: Float64Array = new Float64Array(256);

/** Taylor series to x^23, accurate to double precision on [0, π/2]. */
function exactSin(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 11; n++) {
    term = (-term * x2) / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

const QUARTER = new Float64Array(65);
for (let i = 1; i < 64; i++) QUARTER[i] = exactSin((i / 256) * 2 * Math.PI);
QUARTER[64] = 1; // the series overshoots to 1 + 2^-52 here
for (let i = 0; i < 256; i++) {
  const q = i >> 6, r = i & 63;
  const s = [QUARTER[r]!, QUARTER[64 - r]!, 0 - QUARTER[r]!, 0 - QUARTER[64 - r]!][q]!; // 0 - v avoids -0
  const c = [QUARTER[64 - r]!, 0 - QUARTER[r]!, 0 - QUARTER[64 - r]!, QUARTER[r]!][q]!;
  YAW_SIN[i] = s;
  YAW_COS[i] = c;
}

/** IDLE frame — nothing pressed, facing north. */
export const IDLE_FRAME: InputFrame = { buttons: 0, yaw: 0 };
