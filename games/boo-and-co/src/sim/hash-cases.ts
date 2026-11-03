// Extra cases for the engine's browser-vs-Node hash check:
// `pnpm --filter @umbra/engine browser-hash-check --with <this file>`.
import { MansionSchema, runMansion } from "./mansion.js";
import raw from "../mansion.json";

const mansion = MansionSchema.parse(raw);
const plan = [{ kind: "ghost", x: 4, y: 3 }, { kind: "trap", x: 11, y: 5 }, { kind: "ghost", x: 18, y: 7, tick: 900 }] as const;

export const cases = [
  { name: `boo-and-co/mansion.json  ${mansion.durationTicks} ticks`, run: () => runMansion(mansion, [...plan]).finalStateHash },
];
