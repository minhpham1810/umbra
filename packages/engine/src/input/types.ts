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

/** Precomputed sin/cos table indexed by quantized yaw (0–255). */
export const YAW_SIN = new Float64Array(256);
export const YAW_COS = new Float64Array(256);

for (let i = 0; i < 256; i++) {
  const rad = (i / 256) * 2 * Math.PI;
  // Math.sin/cos here is fine — this runs ONCE at module load, not per tick.
  YAW_SIN[i] = Math.sin(rad);
  YAW_COS[i] = Math.cos(rad);
}

/** IDLE frame — nothing pressed, facing north. */
export const IDLE_FRAME: InputFrame = { buttons: 0, yaw: 0 };
