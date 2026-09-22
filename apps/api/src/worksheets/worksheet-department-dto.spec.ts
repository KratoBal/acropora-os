// The decorators on the DTO read their metadata through `Reflect`, which the
// application installs in `main.ts`. A unit test starts without it, so the
// import has to come first, before the DTO module is evaluated.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateWorksheetDepartmentDto } from "./dto/worksheet.dto.js";

function messagesFor(input: unknown): string[] {
  const dto = plainToInstance(CreateWorksheetDepartmentDto, input);
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("create worksheet department input", () => {
  it("accepts a three-letter code with a real name", () => {
    assert.deepEqual(messagesFor({ code: "BIO", name: "Biodóm" }), []);
  });

  it("says every complaint in Hungarian, including the ones about the name", () => {
    const messages = messagesFor({});

    assert.ok(messages.length > 0, "an empty body has to be refused");
    for (const message of messages) {
      // The default validator text is English ("name must be a string"), and
      // it used to reach the shop floor verbatim, next to a Hungarian
      // sentence.
      assert.ok(
        !/must be|should be/i.test(message),
        `untranslated validator message: ${message}`,
      );
    }
  });

  it("refuses a code that is too long, and says why", () => {
    const messages = messagesFor({ code: "BIOD", name: "Biodóm" });

    assert.deepEqual(messages, [
      "Az alegység kódja legfeljebb három betű vagy szám lehet (pl. BIO vagy A1).",
    ]);
  });

  /**
   * A BEMENET MEGENGEDOBB A TAROLT ALAKNAL, ES EZ SZANDEKOS.
   *
   * A kisbetu ITT atmegy (a repository nagybetusiti), a kanonikus mintan
   * viszont bukik -- lasd `worksheet-number.spec.ts`. A ket szint kulonbsege
   * nem ellentmondas, hanem a normalizalas helye, es ezert all mind a ketto
   * allitasban: ha valaki a normalizalast kiveszi, az egyik oldal elmozdul.
   */
  it("accepts digits, mixed or on their own", () => {
    for (const code of ["A1", "12", "1A2", "bio", "a1"])
      assert.deepEqual(
        messagesFor({ code, name: "Biodóm" }),
        [],
        `a(z) "${code}" kodot el kellett volna fogadnia`,
      );
  });

  /**
   * ES AMI VALTOZATLANUL BUKIK. Enelkul a fenti allitas egy OLYAN
   * megvalositason is zold lenne, amibol a `@Matches` hianyzik.
   */
  it("KONTROLL: a megkötés MEGMARADT -- nem minden kód megy át", () => {
    for (const code of ["ABCD", "1234", "A-1", "Á1", "A 1", ""])
      assert.deepEqual(
        messagesFor({ code, name: "Biodóm" }),
        [
          "Az alegység kódja legfeljebb három betű vagy szám lehet (pl. BIO vagy A1).",
        ],
        `a(z) "${code}" kodot el kellett volna utasitania`,
      );
  });
});

/**
 * A SZULO A FA MIATT KERULT BE, ES SZANDEKOSAN NEM KOTELEZO: a hianya azt
 * jelenti, hogy a helyszin a legfelso szintre kerul. Ez ma az EGYETLEN szint,
 * tehat a regi urlap valtozatlanul atmegy -- egy meglevo kliens nem tor el
 * attol, hogy a mezo letezik.
 *
 * AMIT EZ A FAJL NEM TUD MEGALLAPITANI, es ezert nem is allitja: hogy a
 * megadott azonosito UGYANAHHOZ a partnerhez tartozik-e. Azt csak az
 * adatbazis tudja, es a repository meg is kerdezi -- egy masik partner
 * helyszine ala akasztott alegyseg a munkalapszamot vinne rossz helyre.
 */
describe("create worksheet department input, parent", () => {
  it("accepts the form without a parent - that is the top level", () => {
    assert.deepEqual(messagesFor({ code: "BIO", name: "Biodóm" }), []);
  });

  it("accepts a parent id beside the code", () => {
    assert.deepEqual(
      messagesFor({
        parentId: "clx0000000000000000000000",
        code: "FNM",
        name: "Nagy főkamedence",
      }),
      [],
    );
  });

  it("refuses a parent id that is not text", () => {
    const messages = messagesFor({
      parentId: 42,
      code: "FNM",
      name: "Nagy főkamedence",
    });

    assert.deepEqual(messages, ["A szülő helyszín azonosítója hibás."]);
  });
});
