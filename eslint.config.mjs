// Determinism lint: code that feeds the simulation must not read browser math,
// randomness or clocks (see .kiro/steering/determinism.md).
import tseslint from "typescript-eslint";

const banned = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "log", "pow", "random", "sinh", "cosh", "tanh"]
  .map((property) => ({ object: "Math", property, message: "Engine-dependent result; use the LUT in input/types.ts or exact arithmetic." }));

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
  {
    files: ["packages/engine/src/{core,physics3d,physics2d,spatial,sim,physics,hash,ecs,input}/**/*.ts", "games/boo-and-co/src/sim/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": ["error", ...banned],
      "no-restricted-globals": ["error",
        { name: "Date", message: "Clocks break replays." },
        { name: "performance", message: "Clocks break replays." }],
    },
  },
);
