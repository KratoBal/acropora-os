import { readFileSync } from "node:fs";

/**
 * EGY `export const NÉV: Record<Típus, string> = { ... };` BLOKK ÉRTÉKEI,
 * FORRÁSSZÖVEGBŐL.
 *
 * CSAK TESZTBŐL HASZNÁLD. Ez a mappa (`src/lib/testing`) ki van zárva a
 * fő `tsconfig.json`-ból: az alkalmazás futásidejéhez nincs `node:fs`
 * (a `tsc --noEmit` a metró-buildhez nem ismeri a Node típusait), a
 * `tsconfig.test.json` viszont `"types": ["node"]`-t visz, ott rendben
 * fordul. Ha ez a fájl valaha app-kódba kerülne, a típusellenőrzés
 * hangosan elbukna -- ez a kizárás pontosan azért van, hogy ez ne
 * csendben történjen meg.
 *
 * === MIÉRT KELL EGYÁLTALÁN ===
 *
 * A mobil a pnpm workspace-en KÍVÜL áll (`apps/mobile` a `pnpm-workspace.yaml`
 * kizárási listáján), tehát a `@acropora/types` közös csomagja SOHA nem
 * importálható ide -- sem futásidőben, sem a fordító szintjén. A mobil ezért
 * MINDEN feliratot saját, kézzel karbantartott másolatban tart (állapot,
 * kritikusság, fajta, munkalap-állapot), és a fordító nem tudja összevetni
 * őket a `packages/types` forrásával.
 *
 * Ugyanez a csapda már egyszer megjelent a dokumentum-fajtáknál (lásd
 * `apps/api/src/service-assets/asset-document-type-egyezes.spec.ts`), és a
 * feloldás ugyanaz: a forrásfájl SZÖVEGKÉNT olvasható, akkor is, ha a
 * TÍPUSKÉNT nem importálható. Ez a függvény azt a mintát emeli ki, hogy négy
 * külön spec ne írja le négyszer ugyanazt a reguláris kifejezést -- pont az a
 * fajta másolat, amit ez az egész eszköz kerülni próbál.
 *
 * === MIT NEM VÉD ===
 *
 * Csak EGYSZERŰ `KULCS: "érték",` alakú sorokat ismer fel, idézőjelbe zárt,
 * escape-elt karaktert nem tartalmazó szöveggel. A mai négy címke-tábla mind
 * ilyen -- ha valaha egy érték idézőjelet vagy sablon-literált tartalmazna, ez
 * a függvény hangosan hibázna (nem talál sort), nem csendben adna hibás
 * eredményt.
 */
export function recordLiteralFromSource(
  filePath: string,
  exportName: string,
): Record<string, string> {
  const source = readFileSync(filePath, "utf8");
  const declaration = new RegExp(
    `export const ${exportName}\\s*:[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`,
  );
  const match = declaration.exec(source);
  if (!match)
    throw new Error(`nincs "${exportName}" Record-export ebben: ${filePath}`);
  const body = match[1] ?? "";
  const result: Record<string, string> = {};
  for (const line of body.matchAll(/([A-Z_]+):\s*"([^"]*)"/g))
    result[line[1]!] = line[2]!;
  return result;
}
