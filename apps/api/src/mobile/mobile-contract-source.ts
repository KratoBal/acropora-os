import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A MOBIL-SZERZODES FORRASOLVASOI, EGY HELYEN.
 *
 * KET ORZO HASZNALJA: a `mobile-request-body.spec.ts` (a NEVESITETT tipusokat
 * veti a szerver DTO-jahoz) es a `mobile-request-call-site.spec.ts` (a HIVAS
 * torzseben kiirt kulcsokat). Ket masolat az elso napon egyezne, es utana
 * elcsuszna -- ugyanaz az ok, amiert a kapcsolat-ujraepites futas-sorat is egy
 * helyen allitjuk ossze.
 *
 * Az utvonalak a csomag gyokerehez kepest allnak (`apps/api`), mert a teszt a
 * `test-dist` alol fut: a fajl SAJAT helye nem hasznalhato horgonykent.
 */

/**
 * Egy forrasfajl szovege. A hossz-ellenorzes POZITIV KONTROLL: rossz utvonalnal
 * ket URES halmazt vetnenk ossze, zolden.
 */
export function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** A blokk-kommentek nelkuli szoveg: egy magyarazat nem mezo. */
export function kodSzoveg(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

export function torzs(s: string, fej: string, nev: string): string {
  const start = s.indexOf(`${fej} ${nev} `);
  assert.notEqual(start, -1, `nem találtam: ${fej} ${nev}`);
  const veg = s.indexOf("\n}", start);
  assert.notEqual(veg, -1, `nem találtam a végét: ${nev}`);
  return kodSzoveg(s.slice(start, veg));
}

/**
 * AZ OSOSZTALY NEVE, HA VAN -- ES EZT EGY HAMIS PIROS KERTE.
 *
 * A `CreateWorksheetDto extends WorksheetContentDto`, tehat a `subject` es a
 * `description` az OSBEN all. Nelkule az orzo olyan mezokre jelentett hibat,
 * amiket a szerver ma is elfogad.
 */
export function osNeve(s: string, nev: string): string | null {
  const m = s.match(
    new RegExp(`export class ${nev}\\s+extends\\s+([A-Za-z_]\\w*)`),
  );
  return m ? m[1]! : null;
}

/** Egy `interface` mezoneveinek halmaza. */
export function mezok(s: string, nev: string): Set<string> {
  return new Set(
    [
      ...torzs(s, "export interface", nev).matchAll(
        /^\s{2}([A-Za-z_]\w*)\??\s*:/gm,
      ),
    ].map((m) => m[1]!),
  );
}

/**
 * EGY DTO OSZTALY MEZONEVEI, az ososztalyokkal egyutt.
 *
 * KET ALAKBAN allhatnak, es mind a ketto kell: sajat soron
 * (`  assigneeIds?: string[];`), vagy a dekoratorok UTAN, ugyanabban a sorban
 * (`  @IsString() @IsOptional() customerId?: string | null;`). Csak az elsore
 * merve a jegy DTO-janak a FELE kimaradna.
 */
export function dtoMezok(s: string, nev: string): Set<string> {
  const osszes = new Set<string>();
  const latott = new Set<string>();
  let aktualis: string | null = nev;
  while (aktualis && !latott.has(aktualis)) {
    latott.add(aktualis);
    const t = torzs(s, "export class", aktualis);
    for (const m of t.matchAll(/(?:^\s{2}|\)\s+)([A-Za-z_]\w*)[!?]?\s*:/gm))
      osszes.add(m[1]!);
    aktualis = osNeve(s, aktualis);
  }
  return osszes;
}
