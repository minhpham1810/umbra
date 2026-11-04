/**
 * The engine's example games, set up for the agent tools: the moves a search may make,
 * and a score saying which states look closer to winning.
 * Serve them over MCP with `pnpm --filter umbra-agents mcp --games examples/games.ts`.
 */
import { Character, Transform, type ComponentType, type World } from "umbra-engine";
import type { AgentGame } from "../src/game.js";
import { Body, Eaten, Food, snake, type SnakeInput } from "../../engine/examples/snake/snake.js";
import { Coin, Player, Score, collect, type CollectInput } from "../../engine/examples/collect/collect.js";
import { Goal, room, type RoomInput } from "../../engine/examples/room/room.js";

const pos = (w: World, c: ComponentType) => w.first(c, Transform)?.[2].position;

export const snakeAgent: AgentGame<SnakeInput> = {
  game: snake,
  moves: ["up", "down", "left", "right", null],
  levels: { small: { width: 8, height: 8, goal: 4 }, classic: { width: 16, height: 16, goal: 20 } },
  score(w) {
    const [, body] = w.first(Body)!, food = w.first(Food)?.[1];
    return w.resource(Eaten) * 100 - (food ? Math.abs(body.cells[0]!.x - food.x) + Math.abs(body.cells[0]!.y - food.y) : 0);
  },
};

export const collectAgent: AgentGame<CollectInput> = {
  game: collect,
  hold: 6,
  moves: [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((y) => ({ x, y }))),
  levels: { small: { w: 6, h: 4, goal: 3 }, playground: { w: 8, h: 5, goal: 5 } },
  score(w) {
    const me = pos(w, Player)!, coin = pos(w, Coin);
    return w.resource(Score) * 100 - (coin ? Math.abs(coin.x - me.x) + Math.abs(coin.y - me.y) : 0);
  },
};

export const roomAgent: AgentGame<RoomInput> = {
  game: room,
  hold: 10,
  moves: [{ x: 0, z: 1, jump: false }, { x: 0, z: 1, jump: true }, { x: 1, z: 0, jump: false }, { x: -1, z: 0, jump: false }, { x: 0, z: -1, jump: false }, { x: 0, z: 0, jump: false }],
  levels: { room: null },
  score(w) {
    const me = pos(w, Character)!, goal = pos(w, Goal)!;
    return -Math.hypot(goal.x - me.x, goal.z - me.z) + me.y;
  },
};

export const games: AgentGame[] = [snakeAgent, collectAgent, roomAgent];
