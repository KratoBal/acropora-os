// A DTO dekorátorai a `Reflect`-en át olvassák a metaadatot, amit az
// alkalmazás a `main.ts`-ben telepít. Egy unit teszt enélkül indul, ezért az
// import ELŐBB kell, mint a DTO modul kiértékelése.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SignWorksheetVersionDto } from "./dto/worksheet.dto.js";

/**
 * AZ ALÁÍRÁS BEMENETÉNEK ALAKJA, magyar panaszokkal.
 *
 * Az elutasítás INDOKÁNAK kötelezőségét NEM itt mérjük: az két mezőt köt össze
 * (a döntést és az indokot), ezért a szolgáltatásban áll, és a
 * `worksheets.service.spec.ts` méri. Ez a fájl arról szól, hogy a bemenet
 * alakjára tett panaszok magyarul jutnak ki -- az aláíró nevére tett panasz
 * eddig ANGOLUL jött ("signerName must be shorter than or equal to 200
 * characters"), és ezt ez a teszt mérte ki.
 */

function messagesFor(input: unknown): string[] {
  const dto = plainToInstance(SignWorksheetVersionDto, input);
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

const signer = { signerName: "Kovács Anna" };

describe("worksheet signature input", () => {
  it("accepts a rejection that says why", () => {
    assert.deepEqual(
      messagesFor({
        ...signer,
        decision: "REJECTED",
        note: "A 3. sor mennyisége nem egyezik a leszállítottal.",
      }),
      [],
    );
  });

  /**
   * ELFOGADÁSNÁL VÁLTOZATLAN A SZABÁLY: az indok ott megjegyzés, nem
   * követelmény. Ha ez is kötelezővé válna, a szabály nem szigorúbb lenne,
   * hanem más -- és a partner az aláírásnál akadna el.
   */
  it("leaves acceptance exactly as it was", () => {
    assert.deepEqual(messagesFor({ ...signer, decision: "ACCEPTED" }), []);
    assert.deepEqual(
      messagesFor({ ...signer, decision: "ACCEPTED", note: "Köszönjük." }),
      [],
    );
  });

  /** A magyar panasz-szöveg szabálya itt is áll: a validátor angolja nem mehet ki. */
  it("says every complaint in Hungarian", () => {
    for (const message of messagesFor({ decision: "REJECTED" }))
      assert.ok(
        !/must be|should be|shorter than|longer than/i.test(message),
        `angol validátor-szöveg jutott ki: ${message}`,
      );
  });
});
