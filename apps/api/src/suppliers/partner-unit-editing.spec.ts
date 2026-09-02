// A DTO dekoratorai `Reflect`-en at olvassak a metaadatot, amit az alkalmazas a
// `main.ts`-ben telepit. Egy unit teszt e nelkul indul, tehat az importnak a DTO
// modul kiertekelese ELOTT kell allnia.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  CreateWorksheetDepartmentDto,
  UpdateWorksheetDepartmentDto,
} from "../worksheets/dto/worksheet.dto.js";

function messagesFor(input: unknown): string[] {
  const dto = plainToInstance(UpdateWorksheetDepartmentDto, input);
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

/**
 * A DTO altal ISMERT mezok.
 *
 * A lista nem a bemenetbol jon, hanem az OSZTALYBOL: a `plainToInstance` a
 * cel-osztalyt peldanyositja, es a rajta DEKLARALT mezok akkor is megjelennek,
 * ha a bemenet nem tartalmazza oket. Merve (kalibracio): egy `code` mezo
 * felvetele a DTO-ra ezt a listat `['code','isActive','name']` alakura viszi,
 * tehat az allitas EL TUD BUKNI -- pontosan azon a valtoztatason, amit a
 * tulajdonosi dontes kizar.
 */
function declaredFields(): string[] {
  return Object.keys(
    plainToInstance(UpdateWorksheetDepartmentDto, {
      name: "Biodóm",
      isActive: false,
    }) as object,
  );
}

describe("partner unit editing: what the input allows", () => {
  /**
   * A TULAJDONOS DONTESE, ALLITASSA TEVE (Balazs, 2026-09-02 20:29, Discord):
   * "csak a nevet lehessen atirni menjen az archivalassal".
   *
   * EZ AZ ALLITAS EL TUD BUKNI: aki `code` vagy `parentId` mezot vesz fel a
   * DTO-ra, ezt a sort dontí pirosra. Enelkul a dontes csak egy megjegyzesben
   * allna, es a kovetkezo bovites csendben atlepne rajta.
   */
  it("carries the name and the archive flag, and nothing else", () => {
    assert.deepEqual(declaredFields().sort(), ["isActive", "name"]);
  });

  /**
   * A NEV SZABALYAI UGYANAZOK, MINT FELVITELKOR. Kulon indok nelkul elterni
   * annyit tenne, hogy egy nev, amit LETREHOZNI nem lehet, atnevezessel megis
   * eloallithato -- es az elteres csendes, mert mindket ut kulon fut.
   */
  it("refuses a name the create form would refuse too", () => {
    const tooShort = messagesFor({ name: "B" });
    const tooLong = messagesFor({ name: "x".repeat(201) });

    assert.ok(tooShort.length > 0, "egy karakteres nevet el kell utasitani");
    assert.ok(
      tooLong.length > 0,
      "kétszáznál hosszabb nevet el kell utasitani",
    );

    const createMessages = validateSync(
      plainToInstance(CreateWorksheetDepartmentDto, {
        code: "BIO",
        name: "B",
      }),
    ).flatMap((error) => Object.values(error.constraints ?? {}));
    assert.deepEqual(
      tooShort,
      createMessages.filter((message) => message.includes("két karakter")),
    );
  });

  /**
   * MINDKET MEZO ELHAGYHATO: egy atnevezes nem allitja az archivalast, es egy
   * archivalas nem ir nevet. Ha barmelyik kotelezo lenne, a masik muvelet
   * kenytelen lenne ertekt kuldeni ra -- es akkor egy archivalas csendben
   * felulirna a nevet azzal, amit a felulet epp a kepernyon tartott.
   */
  it("lets each half stand alone", () => {
    assert.deepEqual(messagesFor({ name: "Biodóm" }), []);
    assert.deepEqual(messagesFor({ isActive: false }), []);
  });

  /** Az aktiv jelolés nem szoveg: egy "false" karakterlanc igaz erteknek latszana. */
  it("refuses a string where the archive flag belongs", () => {
    assert.ok(messagesFor({ isActive: "false" }).length > 0);
  });
});
