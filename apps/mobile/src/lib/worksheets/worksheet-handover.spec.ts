import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  atadasAllapota,
  atadasHibaUzenete,
  ATADAS_ISMERETLEN_HIBA,
  canMarkWorksheetHandover,
  handoverGombFelirata,
  handoverKuldendoErtek,
} from "./worksheet-handover";

describe("az átadás gombjának kapuja", () => {
  it("jog nélkül nem jelenik meg", () => {
    assert.equal(canMarkWorksheetHandover({ worksheetsManage: false }), false);
  });

  /*
    ISMERT POZITIV KONTROLL: ugyanaz a fuggveny IGAZAT is tud adni. Enelkul a
    fenti tagadas egy olyan fuggvenyen is zold lenne, ami mindig hamisat ad.
  */
  it("joggal megjelenik", () => {
    assert.equal(canMarkWorksheetHandover({ worksheetsManage: true }), true);
  });
});

/*
  A LAP ALLAPOTA SZANDEKOSAN NEM KAPU, es ezt allitani kell, nem csak leirni.
  A lezarasnal `DRAFT` kell; itt egy mar ALAIRT lap gepe ugyanugy allhat meg
  nalunk. Ha valaki egyszer "kovetkezetesse" teszi a ketto kapujat, ez az
  allitas szol.
*/
describe("az átadás független a lap állapotától", () => {
  it("aláírt lapon is felkínálható", () => {
    assert.equal(canMarkWorksheetHandover({ worksheetsManage: true }), true);
  });
});

describe("a gomb iránya", () => {
  it("átadatlan lapon a RÖGZÍTÉST kínálja, és igazat küld", () => {
    assert.equal(handoverGombFelirata(null), "Átadás rögzítése");
    assert.equal(handoverKuldendoErtek(null), true);
  });

  it("átadott lapon a VISSZAVONÁST kínálja, és hamisat küld", () => {
    const mikor = "2026-09-21T10:00:00.000Z";
    assert.equal(handoverGombFelirata(mikor), "Átadás visszavonása");
    assert.equal(handoverKuldendoErtek(mikor), false);
  });
});

describe("az átadás állapota", () => {
  it("dátum nélkül nincs átadva", () => {
    assert.deepEqual(
      atadasAllapota({ handedOverAt: null, handedOverByName: "Kiss Péter" }),
      { atadva: false },
    );
  });

  /*
    A NEV NEM FELTETELE AZ ATADASNAK. A semaban `onDelete: SetNull`: egy azota
    torolt kollega neve eltunik, az atadas tenye nem. Ha ez a fuggveny a nevre
    agazna, a visszaadott eszkoz ujra "nalunk levonek" latszana.
  */
  it("név nélkül is átadott, ha a dátum megvan", () => {
    assert.deepEqual(
      atadasAllapota({
        handedOverAt: "2026-09-21T10:00:00.000Z",
        handedOverByName: null,
      }),
      { atadva: true, mikor: "2026-09-21T10:00:00.000Z", ki: null },
    );
  });

  it("megadja az átadó nevét, ha megvan", () => {
    assert.deepEqual(
      atadasAllapota({
        handedOverAt: "2026-09-21T10:00:00.000Z",
        handedOverByName: "Kiss Péter",
      }),
      { atadva: true, mikor: "2026-09-21T10:00:00.000Z", ki: "Kiss Péter" },
    );
  });
});

describe("a hiba mondata", () => {
  it("a szerver mondatát adja tovább", () => {
    assert.equal(
      atadasHibaUzenete("A munkalap nem található."),
      "A munkalap nem található.",
    );
  });

  /*
    KET KULON AG, ES MIND A KETTO ELOFORDUL: a `null` az, amikor a hibabol nem
    olvastunk ki uzenetet, az ures string pedig az, amikor a szerver kuldott
    mezot, de uresen. Egy `?? ` alaku visszaeses az elsot megfogna, a masodikat
    nem -- ott egy URES doboz maradna a szerelo kepernyojen.
  */
  it("üzenet nélkül a saját mondatát adja", () => {
    assert.equal(atadasHibaUzenete(null), ATADAS_ISMERETLEN_HIBA);
    assert.equal(atadasHibaUzenete("   "), ATADAS_ISMERETLEN_HIBA);
  });
});
