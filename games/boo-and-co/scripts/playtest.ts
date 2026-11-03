// `pnpm --filter @umbra/boo-and-co playtest [mansion.json]`: balance playtest, as JSON.
// Exits 1 when it finds a balance bug. Defaults to the shipped mansion.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { playtestBalance, strategySummary } from "umbra-agents";
import { mansionGame } from "../src/sim/balance.js";
import { MansionSchema } from "../src/sim/mansion.js";

const file = process.argv[2];
// pnpm --filter runs from this folder; INIT_CWD is where the user ran the command.
const path = file ? resolve(process.env["INIT_CWD"] ?? ".", file) : new URL("../src/mansion.json", import.meta.url);
const mansion = MansionSchema.parse(JSON.parse(await readFile(path, "utf8")));
const { findings, strategy } = playtestBalance(mansionGame(mansion));
console.log(JSON.stringify({ findings, ...strategySummary(strategy) }, null, 2));
process.exit(findings.length ? 1 : 0);
