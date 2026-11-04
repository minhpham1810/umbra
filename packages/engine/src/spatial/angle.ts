/**
 * 2D rotations as Transform quaternions, computed the same on every JavaScript engine.
 * Math.sin, cos and atan2 may differ in the last bit between engines, which would change
 * state hashes; these use only + − × ÷ and sqrt, which IEEE 754 defines exactly.
 * Accurate to about 1e-15.
 */
import type { Quat } from "./transform.js";

const PI = 3.141592653589793;

/** sin and cos of x for |x| ≤ π/2 (Taylor series, error below 1e-17). */
function sinCosSmall(x: number): [number, number] {
  const x2 = x * x;
  let s = 0, c = 0;
  // Horner from the highest term: sin to x^23, cos to x^22.
  for (let n = 23; n >= 3; n -= 2) s = (s + 1) * -x2 / (n * (n - 1));
  for (let n = 22; n >= 2; n -= 2) c = (c + 1) * -x2 / (n * (n - 1));
  return [x * (s + 1), c + 1];
}

/** atan(x) for any x: halve the angle until small, then a Taylor series. */
function atan(x: number): number {
  if (x > 1) return PI / 2 - atan(1 / x);
  if (x < -1) return -PI / 2 - atan(1 / x);
  // atan(x) = 2·atan(x / (1 + √(1 + x²))); two halvings take |x| ≤ 1 to ≤ tan(π/16) ≈ 0.2.
  const h1 = x / (1 + Math.sqrt(1 + x * x));
  const h2 = h1 / (1 + Math.sqrt(1 + h1 * h1));
  const y2 = h2 * h2;
  // atan(y) = y·(1 − y²/3 + y⁴/5 − …), by Horner to y^25.
  let t = 0;
  for (let n = 25; n >= 3; n -= 2) t = 1 / n - y2 * t;
  return 4 * h2 * (1 - y2 * t);
}

/** atan2(y, x), in (−π, π]. */
function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  return y > 0 ? PI / 2 : y < 0 ? -PI / 2 : 0;
}

/** A turn of `angle` radians about z, as a quaternion (2D rotation, counter-clockwise). */
export function rotationZ(angle: number): Quat {
  const half = angle / 2 - Math.round(angle / (4 * PI)) * 2 * PI; // into [−π, π]
  const folded = half > PI / 2 ? half - PI : half < -PI / 2 ? half + PI : half; // q and −q are the same turn
  const [s, c] = sinCosSmall(folded);
  return { x: 0, y: 0, z: s, w: c };
}

/** The turn about z of a quaternion, in (−π, π] (exact for 2D rotations). */
export function angleZ(q: Quat | undefined): number {
  if (!q) return 0;
  const a = 2 * atan2(q.z, q.w);
  return a > PI ? a - 2 * PI : a <= -PI ? a + 2 * PI : a;
}
