const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

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
  {
    // A `require()` KAPU, ES NEM FIGYELMEZTETES.
    //
    // === A MERT ESET, AMI EZT KIVALTOTTA (2026-09-17) ===
    //
    // A #772-ben egy `await import("expo-file-system")` alakot irtam, es az
    // BEHUZTA a react-native globalis tipusait -- attol egy ERINTETLEN spec
    // allt meg, mert a FormData tipusa felulirodott. A javitas `require()` lett
    // (#779), direktivaval. A LINT SZOLT rola, es a kilepesi kod 0 MARADT, tehat
    // a hiba tulelt egy beolvasztast.
    //
    // Egy figyelmeztetes a dontest az olvasora bizza, es a hallgatas
    // alapertelmezese az igen.
    //
    // === AMIT MA FOG, ES AMIT NEM ===
    //
    // MA NULLA fajlt erint, es ez merve van: `require(` PONTOSAN EGYSZER all az
    // `apps/mobile/src` alatt (250 fajlban keresve), es az az egy sor
    // direktivaval, tehat a lint ma is nulla figyelmeztetest ad.
    //
    // Az ertéke tehat NEM a mai allapot, hanem a KOVETKEZO `require`, ami
    // direktiva nelkul kerulne be. Ott mar nem az olvasora bizza a dontest.
    // === A HATOKOR ES A KIVETELEK VALTOZATLANOK, CSAK A SZINT VALTOZIK ===
    //
    // A mai szabaly NEM csupasz `warn`: egy ALLOW-LISTAVAL all, ami az
    // ESZKOZ-fajlokat (kep, hang, font, JSON) engedi `require`-rel, mert React
    // Native-ben az a bevett alak. Egy vak `"error"` azokat IS elvagna -- ma
    // nulla ilyen van a `src` alatt, de a kovetkezo `require("./kep.png")`
    // elbukna rajta, es az HELYES kod. Egy szuro ara az, amit ELVESZ, nem az,
    // amit megfog.
    //
    // A `files` minta is az eredetibol jon (`.ts`, `.tsx`, `.d.ts`). Az elso
    // alakom `.js`-t is bevett, es azzal EZT A FAJLT magat vonta volna a
    // szabaly ala -- egy flat config CommonJS, tehat `require`-rel indul.
    //
    // Mindketto az `eslint-config-expo/flat` 7. objektumabol merve, nem
    // emlekezetbol: a plugin es a szabaly is ott all.
    files: ["**/*.ts", "**/*.tsx", "**/*.d.ts"],
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-require-imports": [
        "error",
        {
          allow: [
            "\\.(aac|aiff|avif|bmp|caf|db|gif|heic|html|jpeg|jpg|json|m4a|m4v|mov|mp3|mp4|mpeg|mpg|otf|pdf|png|psd|svg|ttf|wav|webm|webp|xml|yaml|yml|zip)$",
          ],
        },
      ],
    },
  },
]);
