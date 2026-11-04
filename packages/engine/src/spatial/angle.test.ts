import { expect, it } from "vitest";
import { angleZ, rotationZ } from "./angle.js";

it("matches Math to 1e-15 and round-trips any angle", () => {
  for (let i = -2000; i <= 2000; i++) {
    const a = i * 0.0137;
    const q = rotationZ(a);
    // Same rotation as Math's quaternion (possibly negated: q and −q are one turn).
    const sign = Math.sign(q.w * Math.cos(a / 2) + q.z * Math.sin(a / 2));
    expect(Math.abs(q.z - sign * Math.sin(a / 2))).toBeLessThan(1e-15);
    expect(Math.abs(q.w - sign * Math.cos(a / 2))).toBeLessThan(1e-15);
    const back = angleZ(q);
    const wrapped = Math.atan2(Math.sin(a), Math.cos(a));
    expect(Math.abs(back - wrapped)).toBeLessThan(1e-13);
  }
  expect(angleZ(undefined)).toBe(0);
  expect(angleZ({ x: 0, y: 0, z: 1, w: 0 })).toBeCloseTo(Math.PI);
  expect(rotationZ(0)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
});
