import { expect, it } from "vitest";
import { YAW_COS, YAW_SIN } from "./types.js";

it("yaw LUT matches Math.sin/cos and hits the cardinal directions exactly", () => {
  for (let i = 0; i < 256; i++) {
    const rad = (i / 256) * 2 * Math.PI;
    expect(Math.abs(YAW_SIN[i]! - Math.sin(rad))).toBeLessThan(1e-15);
    expect(Math.abs(YAW_COS[i]! - Math.cos(rad))).toBeLessThan(1e-15);
  }
  expect([YAW_SIN[0], YAW_SIN[64], YAW_SIN[128], YAW_SIN[192]]).toEqual([0, 1, 0, -1]);
  expect([YAW_COS[0], YAW_COS[64], YAW_COS[128], YAW_COS[192]]).toEqual([1, 0, -1, 0]);
});
