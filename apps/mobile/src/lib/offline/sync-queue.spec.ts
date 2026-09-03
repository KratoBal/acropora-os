import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canRetryState,
  classifyFailure,
  operationId,
  worksheetOperationId,
} from "./sync-queue";

/**
 * A KETTOS FELVITEL ES A VEGTELEN UJRAPROBALAS -- ez a ket hiba, amit a
 * protokoll megelozne, es mindketto CSENDES.
 *
 * A kettos felvitel ugy nez ki, mint ket eszkoz; a vegtelen ujraprobalas ugy,
 * mintha a szinkron "meg dolgozna". Egyik sem hibauzenet.
 */

describe("a művelet-azonosító", () => {
  it("ugyanabból a beolvasásból ugyanaz", () => {
    // MI PIROSIT: ha veletlen azonositot adnank. Akkor egy ketszer megnyomott
    // gomb KET sort tenne a sorba, es a szerver ket eszkozt hozna letre.
    const a = operationId({
      qrToken: "QR-A",
      scannedAt: "2026-09-03T08:00:00Z",
    });
    const b = operationId({
      qrToken: "QR-A",
      scannedAt: "2026-09-03T08:00:00Z",
    });
    assert.equal(a, b);
  });

  it("KÉT külön beolvasás két külön művelet, akkor is, ha a kód ugyanaz", () => {
    /*
      A SZANDEKOS ISMETLES NEM DUPLIKATUM. Ha a kulcs csak a kodbol szuletne, a
      masodik beolvasast elnyelnenk -- es a kollega azt latna, hogy a felvitel
      "megtortent", holott a sorban csak az elso all.
    */
    const a = operationId({
      qrToken: "QR-A",
      scannedAt: "2026-09-03T08:00:00Z",
    });
    const b = operationId({
      qrToken: "QR-A",
      scannedAt: "2026-09-03T08:05:00Z",
    });
    assert.notEqual(a, b);
  });

  it("két KÜLÖNBÖZŐ kód két külön művelet", () => {
    // ISMERT POZITIV KONTROLL a fenti ketto melle: ha a fuggveny mindig
    // ugyanazt adna, az elso allitas zold lenne, a masik ketto piros -- ha
    // pedig mindig KULONBOZOT, az elso piros. Ez a harom egyutt koti le.
    const a = operationId({
      qrToken: "QR-A",
      scannedAt: "2026-09-03T08:00:00Z",
    });
    const b = operationId({
      qrToken: "QR-B",
      scannedAt: "2026-09-03T08:00:00Z",
    });
    assert.notEqual(a, b);
  });
});

describe("a hiba besorolása", () => {
  it("a szerver ELUTASÍTÁSA konfliktus, nem hiba", () => {
    /*
      EZ A KULONBSEG A LENYEG. Egy 409 azt jelenti, hogy a felvitel SOHA nem fog
      atmenni valtoztatas nelkul. Ha hibanak vennenk, a sor vegtelenul
      ujraprobalna, es a kollega azt latna, hogy "meg dolgozik".
    */
    assert.equal(classifyFailure(409), "conflict");
    assert.equal(classifyFailure(422), "conflict");
  });

  it("a hálózati és szerver-hiba újrapróbálható", () => {
    assert.equal(classifyFailure(500), "failed");
    assert.equal(classifyFailure(503), "failed");
    assert.equal(classifyFailure(0), "failed");
  });
});

describe("az újrapróbálás", () => {
  it("a konfliktust NEM próbálja újra", () => {
    // A `conflict` sor embert igenyel. Egy automatikus ujraprobalas itt nem
    // csak felesleges: elrejti, hogy dontesre var.
    assert.equal(canRetryState("conflict"), false);
  });

  it("a syncing sort sem, mert az már fut", () => {
    assert.equal(canRetryState("syncing"), false);
  });

  it("a pending és a failed újrapróbálható", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "mindig hamis" valtozat is
    // atmenne a ket fenti allitason.
    assert.equal(canRetryState("pending"), true);
    assert.equal(canRetryState("failed"), true);
  });
});

describe("a munkalap művelet-azonosítója", () => {
  it("UGYANAZ a partner és időpont UGYANAZT a kulcsot adja", () => {
    /*
      A kulcs a tartalombol szuletik, es UGYANEZ megy fel a szervernek is
      `clientOperationId` neven. Ha veletlen kulcsot adnank, egy megszakadt
      kuldes ujrakuldese MASODIK munkalapot hozna letre a szerveren.
    */
    const a = worksheetOperationId({
      customerId: "customer-42",
      startedAt: "2026-09-03T10:00:00.000Z",
    });
    const b = worksheetOperationId({
      customerId: "customer-42",
      startedAt: "2026-09-03T10:00:00.000Z",
    });
    assert.equal(a, b);
  });

  it("KÉT lap ugyanannál a partnernél KÉT kulcsot kap", () => {
    /*
      MI PIROSIT: ha a kulcs csak a partnerbol keszulne. Akkor a nap masodik
      munkalapja a beszurasnal csendben elesne (`INSERT OR IGNORE`), es a
      szerelo azt hinne, hogy felvitte -- holott csak az elso lap all a sorban.
    */
    assert.notEqual(
      worksheetOperationId({
        customerId: "customer-42",
        startedAt: "2026-09-03T10:00:00.000Z",
      }),
      worksheetOperationId({
        customerId: "customer-42",
        startedAt: "2026-09-03T11:30:00.000Z",
      }),
    );
  });

  it("a MUNKALAP kulcsa nem ütközhet az ESZKÖZÉVEL", () => {
    // A ket kulcs UGYANABBAN a tablaban, ugyanabban az oszlopban all -- a
    // sorban es a szerveren is. Az elotag az, ami elvalasztja oket.
    const lap = worksheetOperationId({
      customerId: "x",
      startedAt: "2026-09-03T10:00:00.000Z",
    });
    const eszkoz = operationId({
      qrToken: "x",
      scannedAt: "2026-09-03T10:00:00.000Z",
    });
    assert.notEqual(lap, eszkoz);
  });
});
