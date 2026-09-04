import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException, NotFoundException } from "@nestjs/common";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/**
 * A MUNKANAPLO SZERVER-OLDALA.
 *
 * A szerkeszthetoseg JOGOSULTSAGI szabaly, nem kepernyo-logika: ha csak a
 * felulet szurne, a vegpontot barki hivhatna kozvetlenul. Ezert a kalibracio a
 * SZERVER agat rontja el, nem a gombot.
 */

const CREATED = new Date("2026-09-04T08:00:00.000Z");

function repository(overrides: Record<string, unknown> = {}) {
  return {
    entries: async () => ({
      worksheetCreatedById: "keszito-1",
      serviceJobOpenedById: "nyito-1",
      rows: [
        {
          id: "entry-1",
          body: "Szivattyú csere",
          authorName: "Szerelő Sándor",
          createdAt: CREATED,
          updatedAt: CREATED,
        },
      ],
    }),
    addEntry: async () => undefined,
    updateEntry: async () => 1,
    detail: async () => ({ id: "worksheet-1" }),
    ...overrides,
  } as unknown as WorksheetsRepository;
}

function service(overrides: Record<string, unknown> = {}) {
  return new WorksheetsService(repository(overrides));
}

describe("a munkanapló olvasása", () => {
  it("a szerző neve ISMERETLEN is lehet, és akkor is ott a sor", async () => {
    /*
      A szerzo azonositoja `SetNull` a felhasznalo torlesekor: egy tavozo
      kollega bejegyzese NEM tunhet el, mert a naplo rola szol.

      MI PIROSIT: ha a lekepezes kihagyna a nev nelkuli sorokat, vagy ures
      sztringgel toltene ki -- az ures sztring a kepernyon ugy nezne ki, mint
      egy betoltesi hiba.
    */
    const out = await service({
      entries: async () => ({
        worksheetCreatedById: null,
        serviceJobOpenedById: null,
        rows: [
          {
            id: "entry-1",
            body: "Régi bejegyzés",
            authorName: null,
            createdAt: CREATED,
            updatedAt: CREATED,
          },
        ],
      }),
    }).entries("worksheet-1", "user-1");
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0]?.authorName, null);
  });

  it("NEM LÉTEZŐ lapra 404, nem üres lista", async () => {
    /*
      EZ A KULONBSEG NEM SZORSZALHASOGATAS: egy ures lista azt allitja, hogy a
      lap letezik es nincs rajta bejegyzes. A szerelo ilyenkor ujra beirna a
      munkat -- egy MASIK, nem letezo lapra.

      MI PIROSIT: ha a hianyzo lapra ures listat adnank.
    */
    await assert.rejects(
      () => service({ entries: async () => null }).entries("nincs", "user-1"),
      NotFoundException,
    );
  });
});

describe("a bejegyzés szerkesztése a szerveren", () => {
  it("a lap KÉSZÍTŐJE átírhatja", async () => {
    const out = await service().updateEntry(
      "worksheet-1",
      "entry-1",
      "Javított szöveg",
      "keszito-1",
    );
    assert.equal(out.items.length, 1);
  });

  it("a hibajegy NYITÓJA is átírhatja", async () => {
    // A MASODIK AG KULON ALLITAS: egy valtozat, ami csak a lap keszitojet
    // nezi, a fenti allitason atmenne.
    const out = await service().updateEntry(
      "worksheet-1",
      "entry-1",
      "Javított szöveg",
      "nyito-1",
    );
    assert.equal(out.items.length, 1);
  });

  it("MÁS NEM írhatja át, és ezt a SZERVER mondja ki", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN, es azert a szolgaltatason all,
      nem a kepernyon: ha a gomb eltunik, de a vegpont enged, a lyuk NYITVA
      van, es egy kepernyore irt teszt zold marad.

      MI PIROSIT: a `canEditWorksheetEntry` kapu kivetele az `updateEntry`
      agbol -- olyankor a valasz `canEdit` mezoje TOVABBRA IS hamis lenne,
      tehat a felulet helyesen viselkedne, es csak a vegpont engedne at.
    */
    await assert.rejects(
      () => service().updateEntry("worksheet-1", "entry-1", "Idegen", "user-9"),
      ForbiddenException,
    );
  });

  it("MÁSIK LAP bejegyzését nem lehet átírni", async () => {
    /*
      A jogosultsagot a LAP keszitojebol szamoljuk, tehat aki ezen a lapon
      jogosult, egy masik lap bejegyzeset is atirhatna, ha az iras nem szurne a
      lapra is. A tarolo `WHERE` zaradeka szur, es a nulla mozdult sor NEM
      siker.

      MI PIROSIT: ha a nulla darabszamot sikernek olvasnank.
    */
    await assert.rejects(
      () =>
        service({ updateEntry: async () => 0 }).updateEntry(
          "worksheet-1",
          "masik-lap-bejegyzese",
          "Javított",
          "keszito-1",
        ),
      NotFoundException,
    );
  });

  it("a válasz MEGMONDJA, miért nem szerkeszthető", async () => {
    /*
      Egy magyarazat nelkul hianyzo gomb ugy nez ki, mint hiba a programban. A
      mondat a valaszban all, tehat a ket kliens (web es mobil) ugyanazt
      mutatja, es egyik sem talalja ki a sajatjat.
    */
    const out = await service().entries("worksheet-1", "user-9");
    assert.equal(out.items[0]?.canEdit, false);
    assert.match(out.items[0]?.editRefusal ?? "", /munkalap készítője/);
  });
});
