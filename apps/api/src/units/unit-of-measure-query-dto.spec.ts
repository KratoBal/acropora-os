// A dekoratorok `Reflect`-en at olvassak a metaadatot, amit az alkalmazas a
// `main.ts`-ben telepit. Egy egysegteszt enelkul indul, tehat az importnak a
// DTO modul kiertekelese ELE kell kerulnie.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UnitOfMeasureListQueryDto } from "./dto/unit-of-measure.dto.js";

/**
 * A LEKERDEZESI SORBAN MINDEN ERTEK SZOVEG -- ES A KEZENFEKVO ALAK NEMAN ROSSZ.
 *
 * `@Type(() => Boolean)` a szovegen `Boolean(...)`-t hiv, ami minden nem ures
 * szovegre igaz. Merve a SAJAT DTO-mon, mielott javitottam: `"false"` -> `true`,
 * `"0"` -> `true`, mind a ketto NULLA validacios hibaval.
 *
 * A kar iranya a rosszabbik fajta: aki azt keri, hogy NE mutassuk a
 * kivezetetteket, epp azokat latna -- es semmi nem szolna rola. Ezert all
 * allitas a `false` agon, nem csak a `true`-n.
 */
function dto(ertek: unknown) {
  return plainToInstance(UnitOfMeasureListQueryDto, {
    kind: "PERFORMANCE",
    includeInactive: ertek,
  });
}

function hibak(ertek: unknown) {
  return validateSync(dto(ertek)).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );
}

describe("a mértékegység-lista lekérdezése", () => {
  it("a `true` szöveg igazat jelent", () => {
    assert.equal(dto("true").includeInactive, true);
    assert.deepEqual(hibak("true"), []);
  });

  /** EZ AZ AZ ALLITAS, AMIERT A FAJL LETEZIK. */
  it("a `false` szöveg HAMISAT jelent, nem igazat", () => {
    assert.equal(
      dto("false").includeInactive,
      false,
      "a `?includeInactive=false` kérésre a kivezetettek NEM jöhetnek vissza",
    );
    assert.deepEqual(hibak("false"), []);
  });

  it("a hiányzó mező rendben van: alapból csak az aktívak", () => {
    assert.equal(dto(undefined).includeInactive, undefined);
    assert.deepEqual(hibak(undefined), []);
  });

  /**
   * AZ ELGEPELES 400-AT AD, NEM CSENDES "NEM"-ET.
   *
   * Ha a segedfuggveny az ismeretlen szovegre `false`-ra esne vissza, egy
   * `?includeInactive=ture` NEMAN a szukebb listat adna. A hivo azt hinne,
   * hogy kerte a kivezetetteket, es azt latna, hogy nincsenek.
   */
  it("POZITÍV KONTROLL: az elgépelt érték ELBUKIK", () => {
    const uzenet = hibak("ture");
    assert.ok(
      uzenet.length > 0,
      "a validáció nem fut, vagy mindent átenged: a mérés semmit nem ér",
    );
    assert.ok(uzenet.some((m) => m.includes("includeInactive")));
  });

  /** A fajta KOTELEZO: fajta nelkul a harom vilag egyvelege jonne vissza. */
  it("a fajta nélküli kérés ELBUKIK", () => {
    const uzenet = validateSync(
      plainToInstance(UnitOfMeasureListQueryDto, {}),
    ).flatMap((e) => Object.values(e.constraints ?? {}));
    assert.ok(uzenet.some((m) => m.includes("kind")));
  });
});
