/**
 * Example: Snake, on the generic core only (no physics, no rendering).
 * Eat food to grow; hitting a wall or yourself ends the run. Food appears where the
 * seeded rng puts it, so a seed and a list of turns replay exactly.
 */
import { z } from "zod";
import { defineComponent, defineEvent, defineGame, defineResource, type World } from "../../src/index.js";

const Cell = z.object({ x: z.number().int(), y: z.number().int() });
type Cell = z.infer<typeof Cell>;

/** The snake's body, head first, and the direction it moves. */
export const Body = defineComponent("body", z.object({ cells: z.array(Cell).min(1), dir: z.enum(["up", "down", "left", "right"]) }));
export const Food = defineComponent("food", Cell);
export const Eaten = defineResource("eaten", z.number().int().min(0), () => 0);
export const Ate = defineEvent("ate", Cell);

export const SnakeLevel = z.object({
  width: z.number().int().min(4).max(64),
  height: z.number().int().min(4).max(64),
  /** Food eaten to win. */
  goal: z.number().int().min(1),
});
export type SnakeLevel = z.infer<typeof SnakeLevel>;

/** Per tick: turn, or keep going (null). */
export const SnakeInput = z.enum(["up", "down", "left", "right"]).nullable();
export type SnakeInput = z.infer<typeof SnakeInput>;

const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" } as const;
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

function placeFood(world: World, level: SnakeLevel) {
  const [, body] = world.first(Body)!;
  const free: Cell[] = [];
  for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) if (!body.cells.some((c) => c.x === x && c.y === y)) free.push({ x, y });
  const cell = world.rng.pick(free);
  if (cell) world.spawn(Food(cell));
}

export const snake = defineGame<SnakeInput, SnakeLevel>({
  name: "snake",
  version: "1",
  input: SnakeInput,
  level: SnakeLevel,
  components: [Body, Food],
  resources: [Eaten],
  events: [Ate],
  setup(world, level) {
    const y = Math.floor(level.height / 2);
    world.spawn(Body({ cells: [{ x: 2, y }, { x: 1, y }, { x: 0, y }], dir: "right" }));
    placeFood(world, level);
  },
  systems: [
    function steer(world, turn) {
      for (const [, body] of world.query(Body)) if (turn && turn !== OPPOSITE[body.dir]) body.dir = turn;
    },
    function move(world, _input, level) {
      for (const [, body] of world.query(Body)) {
        const [dx, dy] = STEP[body.dir];
        const head = { x: body.cells[0]!.x + dx, y: body.cells[0]!.y + dy };
        const food = [...world.query(Food)].find(([, f]) => same(f, head));
        body.cells.unshift(head);
        if (food) {
          world.despawn(food[0]);
          world.setResource(Eaten, world.resource(Eaten) + 1);
          world.emit(Ate, head);
          placeFood(world, level);
        } else body.cells.pop();
      }
    },
  ],
  outcome(world, level) {
    if (world.resource(Eaten) >= level.goal) return "win";
    for (const [, { cells: [head, ...rest] }] of world.query(Body)) {
      const out = head!.x < 0 || head!.y < 0 || head!.x >= level.width || head!.y >= level.height;
      if (out || rest.some((c) => same(c, head!))) return "dead";
    }
    return undefined;
  },
});
