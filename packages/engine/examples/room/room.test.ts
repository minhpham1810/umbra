import { expect, it } from "vitest";
import { recordReplay, runGame, verifyReplay } from "../../src/index.js";
import { room, type RoomInput } from "./room.js";

const hold = (ticks: number, i: Partial<RoomInput>): RoomInput[] => Array.from({ length: ticks }, () => ({ x: 0, z: 0, jump: false, ...i }));

/** Push the crate against the ledge, then jump onto it and up to the goal. */
export const route: RoomInput[] = [...hold(70, { z: 1 }), ...hold(10, { z: 1, jump: true }), ...hold(60, { z: 1 }), ...hold(10, { z: 1, jump: true }), ...hold(60, { z: 1 })];

it("cannot reach the goal by jumping at the ledge without the crate", async () => {
  const r = await runGame(room, null, { inputs: [...hold(20, { x: 1 }), ...hold(300, { z: 1, jump: true })] });
  expect(r.outcome).toBeUndefined();
});

it("reaches the goal by pushing the crate to the ledge and climbing it, and replays exactly", async () => {
  const r = await runGame(room, null, { inputs: route });
  expect(r.outcome).toBe("win");
  const replay = await recordReplay(room, null, { inputs: route });
  expect((await verifyReplay(room, replay)).ok).toBe(true);
});
