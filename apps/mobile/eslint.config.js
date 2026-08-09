const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...expoConfig,
  {
    // test-dist/ is the compiled JS output of `npm run test` (tsc -p
    // tsconfig.test.json), gitignored via the root .gitignore's
    // `test-dist/` rule. ESLint's flat config does not read .gitignore on
    // its own, so it needs its own `ignores` entry here — without it,
    // `eslint .` also lints the generated CommonJS output (which fails
    // rules like no-var that only make sense for hand-written source).
    ignores: [".expo/**", "dist/**", "test-dist/**", "android/**", "ios/**"],
  },
]);
