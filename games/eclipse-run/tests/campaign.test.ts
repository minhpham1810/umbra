import { describe, expect, it } from 'vitest';
import { BUTTON, createSimulation, SceneSchema } from '@umbra/engine';
import { levels } from '../src/levels.js';

describe('real Umbra campaign playthroughs', () => {
  it('provides a five-stage campaign', () => expect(levels).toHaveLength(5));
  for (let index = 0; index < 5; index++) {
    it(`completes chapter ${index + 1} using real physics`, async () => {
      const level = levels[index]!;
      const sim = await createSimulation(SceneSchema.parse(level.scene));
      try {
        for (const point of level.route) {
          for (let t = 0; t < 2400 && sim.outcome === 'timeout'; t++) {
            const pos = sim.position();
            if (point.rideUntil !== undefined) {
              if (pos.z <= point.rideUntil) break;
              const platform = sim.platforms()[1]!;
              const go = pos.z > 12.6 || (pos.z > 11.8 ? platform.z > 11.4 : pos.z < 6.7 || platform.z < 6.7);
              sim.step({ buttons: go ? BUTTON.FORWARD : 0, yaw: 128 });
              continue;
            }
            const dx = point.x - pos.x, dz = point.z - pos.z;
            const near = Math.hypot(dx, dz) < 0.22;
            const goalDone = !point.goal || sim.events.some(e => e.goalId === point.goal);
            if (near && goalDone && sim.grounded) break;
            const yaw = (Math.round(Math.atan2(dx, dz) * 256 / (2 * Math.PI)) + 256) % 256;
            sim.step({ buttons: (near ? 0 : BUTTON.FORWARD) | (!near && point.jump ? BUTTON.JUMP : 0), yaw });
          }
          expect(sim.outcome, `route point ${JSON.stringify(point)} at ${JSON.stringify(sim.position())}`).not.toBe('out_of_bounds');
        }
        expect(sim.outcome, JSON.stringify(sim.position())).toBe('win');
        expect(sim.events.filter(e => e.kind === 'goal_reached')).toHaveLength(4);
      } finally { sim.dispose(); }
    });
  }
  it('a fall ends the run, and restarting creates an untouched stage', async () => {
    const sim = await createSimulation(levels[0]!.scene);
    for (let t = 0; t < 500; t++) sim.step({ buttons: BUTTON.RIGHT, yaw: 0 });
    expect(sim.outcome).toBe('out_of_bounds');
    sim.dispose();
    const fresh = await createSimulation(levels[0]!.scene);
    expect(fresh.events).toEqual([]);
    expect(fresh.outcome).toBe('timeout');
    fresh.dispose();
  });
});
