/**
 * Games Studio can re-run. A replay names its game, and Studio needs that game's code to
 * re-simulate it; add your own game here to view its replays.
 */
import type { Game } from "umbra-engine";
import { snake } from "../../../packages/engine/examples/snake/snake.js";
import { collect } from "../../../packages/engine/examples/collect/collect.js";
import { room } from "../../../packages/engine/examples/room/room.js";

export const games: readonly Game<any, any>[] = [snake, collect, room];
