import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  connectionErrorText,
  hasConnectionErrorText,
  type ConnectionSystem,
} from "./connection-error-text";

/*
  A KAPCSOLAT-HIBAKÓDOK MAGYAR MONDATAI (UI-áttekintés, 4. csomag, 2026-11-03). MI PIROSÍT:
  ha az API kódlistáján új kód jelenik meg, amihez nincs mondat (a felhasználó újra a nyers
  kódot látná); ha egy mondatban a nyers kód vagy angol szó marad; ha az ismeretlen kód a
  nyers szöveget adja vissza. A kódlistát az API forrásából olvassuk, nem másoljuk ide: a
  teszt akkor is megfogja az új kódot, ha senki nem emlékszik erre a fájlra.
*/
const API = join(process.cwd(), "..", "api", "src");
const LISTAK: Array<[ConnectionSystem, string]> = [
  ["UNAS", "imports/unas/unas-connection.types.ts"],
  ["NAV", "integrations/nav/nav-connection.types.ts"],
];

function kodok(system: ConnectionSystem, ut: string): string[] {
  const forras = readFileSync(join(API, ut), "utf8");
  const tomb = new RegExp(
    `${system}_CONNECTION_ERROR_CODES\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`,
  ).exec(forras);
  if (!tomb) throw new Error(`nincs kódlista: ${ut}`);
  return [
    ...tomb[1]!.matchAll(new RegExp(`"(${system}_[A-Z0-9_]+)"`, "g")),
  ].map((m) => m[1]!);
}

describe("a kapcsolat-hibakódok mondatai", () => {
  for (const [system, ut] of LISTAK) {
    it(`${system}: a kódlista olvasható, és minden kódnak van mondata`, () => {
      const lista = kodok(system, ut);
      expect(lista.length).toBeGreaterThan(15);
      for (const kod of lista) {
        expect(hasConnectionErrorText(kod, system), kod).toBe(true);
      }
    });

    it(`${system}: egyik mondatban sem marad nyers kód vagy nagybetűs azonosító`, () => {
      for (const kod of kodok(system, ut)) {
        const mondat = connectionErrorText(kod, system);
        expect(mondat, kod).not.toMatch(/[A-Z]{2,}_[A-Z]/);
        expect(mondat.endsWith("."), kod).toBe(true);
      }
    });
  }

  it("az ismeretlen kód általános mondatot kap, a nyers szöveget nem", () => {
    const mondat = connectionErrorText("UNAS_VALAMI_UJ", "UNAS");
    expect(mondat).toBe(
      "A kapcsolat ellenőrzése nem sikerült (ismeretlen ok).",
    );
    expect(hasConnectionErrorText("UNAS_VALAMI_UJ", "UNAS")).toBe(false);
  });

  it("a rendszer neve a mondatban a sajátja", () => {
    expect(connectionErrorText("NAV_CONNECTION_TIMEOUT", "NAV")).toBe(
      "A NAV nem válaszolt időben.",
    );
    expect(connectionErrorText("UNAS_CONNECTION_TIMEOUT", "UNAS")).toBe(
      "Az UNAS nem válaszolt időben.",
    );
  });
});
