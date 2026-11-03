import { expect, it } from "vitest";
import { sceneValidate, navBake, navPath, navDispose } from "./api.js";

it("exposes navigation through the agent API", async () => {
  const validated = sceneValidate({ pieces: [], spawn: { pos: { x: 0, y: 1, z: 0 } }, goals: [] });
  expect(validated.ok).toBe(true);
  if (!validated.ok) throw new Error(validated.errors.join(", "));
  const baked = await navBake(validated.scene);
  try {
    expect(baked.islands).toEqual([]);
    expect(navPath(baked.navmeshId, validated.scene.spawn.pos, validated.scene.spawn.pos))
      .toEqual({ found: false, waypoints: [] });
  } finally { navDispose(baked.navmeshId); }
  expect(() => navPath(baked.navmeshId, validated.scene.spawn.pos, validated.scene.spawn.pos)).toThrow();
});
