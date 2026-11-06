#!/usr/bin/env node
/*
  A NYEREMENYJATEK MEGEROSITO LEVELENEK ELONEZETE, KULDES NELKUL.

    node apps/api/scripts/jatek-level-elonezet.mjs [kimenet.html] [--felirat "szoveg"] [--kerdes "szoveg"] [--zaras 2026-11-13T22:59:59Z]

  Ugyanazt a torzset rendereli, amit a kuldes (`renderConfirmationMail`), es ugyanabba a keretbe teszi, amibe a MIME-epito
  (`mailHtmlDocument`: a gomb itt kapja az inline stilusat), majd HTML fajlba irja. NEM kuld, nem er hozza az adatbazishoz
  vagy a levelkuldohoz; a link egy NEM VALODI tokent visz. Mellé egy `.txt` kerul: a levél sima szöveges alternativája.

  Elofeltetel: lefordított kimenet. A szkript sorban keresi: `dist` (`pnpm --filter @acropora/api build`), `test-dist`
  (`pnpm --filter @acropora/api test` utan marad), `test-dist-game` (szűk teszt-forditas). Ha egyik sincs, megmondja.
*/
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const itt = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const kapcsolo = (nev, alap) => {
  const i = args.indexOf(`--${nev}`);
  if (i === -1) return alap;
  const ertek = args[i + 1];
  args.splice(i, 2);
  return ertek;
};
// a VALASZTOS kerdes felirata (a mi szovegunk); szabad szoveges valasz nem kerul a levelbe, ezert nincs ra kapcsolo
const felirat = kapcsolo("felirat", null);
const kerdes = kapcsolo("kerdes", "Melyik a legismertebb zátonyépítő korall?");
const zaras = new Date(kapcsolo("zaras", "2026-11-13T22:59:59Z"));
const kimenet = resolve(args[0] ?? "jatek-megerosito-level.html");

const gyokerek = ["dist", "test-dist", "test-dist-game"]
  .map((d) => resolve(itt, "..", d))
  .filter((d) => existsSync(resolve(d, "game", "game-confirmation-mail.js")));
if (gyokerek.length === 0) {
  console.error(
    "Nincs lefordított kimenet (dist, test-dist vagy test-dist-game). Előbb: pnpm --filter @acropora/api build",
  );
  process.exit(1);
}
const gyoker = gyokerek[0];
const { renderConfirmationMail } = await import(
  pathToFileURL(resolve(gyoker, "game", "game-confirmation-mail.js")).href
);
const { mailHtmlDocument } = await import(
  pathToFileURL(resolve(gyoker, "notifications", "mail", "mime.js")).href
);

const { html, text } = renderConfirmationMail({
  link: "https://jatek-teszt.acropora.hu/megerosites?token=ELONEZET-NEM-VALODI-TOKEN",
  prompt: kerdes,
  choiceLabel: felirat,
  closesAt: zaras,
});
writeFileSync(kimenet, mailHtmlDocument(html), "utf8");
writeFileSync(kimenet.replace(/\.html?$/, "") + ".txt", text + "\n", "utf8");
console.log(`HTML: ${kimenet}`);
console.log(`Szöveg: ${kimenet.replace(/\.html?$/, "")}.txt`);
console.log(`Forrás: ${gyoker}`);
