import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeQueueEntry,
  describeQueueError,
  toQueueEntries,
} from "./queue-inspection";
import type { SyncQueueRow } from "./sync-queue";

/**
 * AMIT A SZERELO LAT, AMIKOR VALAMI ELAKAD.
 *
 * A megallas 2026-09-03-tol letezik, es vele egy zsakutca: a sav kimondta, hogy
 * segitseg kell, es nem volt hova menni vele. Ezek az allitasok azt kotik le,
 * hogy a kiut MIT mond es MIT enged.
 */

const sor = (over: Partial<SyncQueueRow> = {}): SyncQueueRow => ({
  id: "op-1",
  operation: "create",
  entityType: "asset",
  entityId: null,
  payloadJson: JSON.stringify({ name: "Szivattyú" }),
  createdAt: "2026-09-03T09:00:00Z",
  attemptCount: 0,
  lastError: null,
  lastAttemptAt: null,
  state: "pending",
  ...over,
});

describe("a hibaszöveg emberi alakja", () => {
  it("a NYERS szerver-hibát lefordítja, és megtartja az eredetit", () => {
    /*
      MERVE: a megallt sornal a legvaloszinubb szoveg ez, mert egy 5xx tipikusan
      NEM JSON valasz (atjaro, HTML hibaoldal, osszeomlott folyamat). A
      szerelonek ez nem informacio -- az IRODANAK viszont igen, ezert a nyers
      szoveg megmarad.
    */
    const out = describeQueueError("API request failed (500).");
    assert.match(out.message ?? "", /nem a felvitellel van/);
    assert.equal(out.raw, "API request failed (500).");
  });

  it("a HÁLÓZATI hibáról megmondja, hogy magától rendbe jön", () => {
    const out = describeQueueError("A szerver jelenleg nem érhető el.");
    assert.match(out.message ?? "", /magától rendbe jön/);
  });

  it("ISMERETLEN alakra NEM talál ki mondatot", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. Egy fordito, ami MINDENRE ad
      valamit, ugyanaz a csapda, mint egy mero, ami mindenre ugyanazt mondja: a
      szerver sajat magyar uzenetei (a NestJS `message` mezoje) mar EMBERI
      mondatok, es egy ratett "forditas" csak rontana rajtuk.

      MI PIROSIT: egy tartalek-ag, ami minden fel nem ismert szoveget
      atfogalmaz.
    */
    const eredeti = "A matricakód megadása kötelező az eszköz felvitelekor.";
    const out = describeQueueError(eredeti);
    assert.equal(out.message, eredeti);
    // A nyers sor ilyenkor NEM ismetlodik meg masodszor a keperno alja.
    assert.equal(out.raw, null);
  });

  it("hiba NÉLKÜL nincs mit mondani", () => {
    assert.deepEqual(describeQueueError(null), { message: null, raw: null });
  });
});

describe("mi ez a sor", () => {
  it("eszköznél a NEVÉT mutatja, nem a művelet-azonosítót", () => {
    // A muvelet-azonosito (`asset-create:V2196:...`) az irodanak adat, a
    // helyszinen allo embernek nem.
    assert.deepEqual(describeQueueEntry(sor()), {
      kind: "Eszköz",
      title: "Szivattyú",
    });
  });

  it("munkalapnál a TÁRGYÁT", () => {
    const out = describeQueueEntry(
      sor({
        entityType: "worksheet",
        payloadJson: JSON.stringify({ subject: "Szivattyú csere" }),
      }),
    );
    assert.deepEqual(out, { kind: "Munkalap", title: "Szivattyú csere" });
  });

  it("fényképnél a FÁJLNEVET", () => {
    const out = describeQueueEntry(
      sor({
        operation: "upload-photo",
        payloadJson: JSON.stringify({
          uri: "file:///kep.jpg",
          name: "kep.jpg",
          type: "image/jpeg",
          recordingOperationId: "r1",
        }),
      }),
    );
    assert.deepEqual(out, { kind: "Fénykép", title: "kep.jpg" });
  });

  it("SÉRÜLT payloadnál sem marad üresen a sor", () => {
    // Egy cim nelkuli sor a listaban ugy nezne ki, mint egy hiba a listaban.
    const out = describeQueueEntry(sor({ payloadJson: "nem json" }));
    assert.equal(out.title, "név nélkül");
  });
});

describe("melyik sorral mit lehet kezdeni", () => {
  it("a MEGÁLLT soron van újrapróbálás", () => {
    const [entry] = toQueueEntries([sor({ state: "stalled" })]);
    assert.equal(entry?.section, "stalled");
    assert.equal(entry?.canRetry, true);
  });

  it("az ELAKADT soron NINCS újrapróbálás", () => {
    /*
      MI PIROSIT: ha a gomb a conflict soron is megjelenne. Ugyanaz a keres
      ugyanazt a valaszt kapna, es a gomb AZT IGERNE, hogy megoldodik -- egy
      gomb, ami nem tud segiteni, rosszabb a hianyanal.
    */
    const [entry] = toQueueEntries([sor({ state: "conflict" })]);
    assert.equal(entry?.section, "conflict");
    assert.equal(entry?.canRetry, false);
  });

  it("a VÁRAKOZÓ sorokon sincs, mert nincs velük teendő", () => {
    for (const state of ["pending", "failed", "syncing"] as const) {
      const [entry] = toQueueEntries([sor({ state })]);
      assert.equal(entry?.section, "waiting");
      assert.equal(entry?.canRetry, false);
    }
  });

  it("az ELAKADT eszköz-felvitelen VAN javítás", () => {
    const [entry] = toQueueEntries([sor({ state: "conflict" })]);
    assert.equal(entry?.canFix, true);
  });

  it("a JAVÍTÁS és az ÚJRAPRÓBÁLÁS kizárja egymást", () => {
    /*
      EZ A LENYEG, ES EZERT NEM ELEG KULON-KULON ALLITANI A KETTOT: a ket gomb
      MAS teendore kuld. Az ujraprobalas a megallt soron van (a SZERVERREL van
      baj, varni kell), a javitas az elakadton (a FELVITELLEL van baj, at kell
      irni). Ha valaha mindketto megjelenne ugyanazon a soron, a szerelo a
      rossz felet kezdene javitani.

      MI PIROSIT: barmelyik feltetel kiszelesitese ugy, hogy a ket halmaz
      atfedjen.
    */
    for (const state of [
      "stalled",
      "conflict",
      "pending",
      "failed",
      "syncing",
    ] as const) {
      const [entry] = toQueueEntries([sor({ state })]);
      assert.equal(
        entry?.canRetry && entry?.canFix,
        false,
        `${state}: mindkét gomb megjelenne`,
      );
    }
  });

  it("MUNKALAP-felvitelen NINCS javítás, és ez szándékos", () => {
    /*
      IDOZITETT HATAR, nem hiany: a valodi utkozes az eszkoz-felvitelnel
      keletkezik (matricakod). A munkalap lathato marad, de nem feloldhato --
      az indok a `queue-resend.ts` fejlecében all, hogy a kovetkezo olvaso ne
      irja meg megegyszer.
    */
    const [entry] = toQueueEntries([
      sor({ state: "conflict", entityType: "worksheet" }),
    ]);
    assert.equal(entry?.canFix, false);
  });

  it("FÉNYKÉP-soron sincs javítás", () => {
    const [entry] = toQueueEntries([
      sor({ state: "conflict", operation: "upload-photo" }),
    ]);
    assert.equal(entry?.canFix, false);
  });

  it("az ELAKADT soron van elvetés, a többin nincs", () => {
    assert.equal(
      toQueueEntries([sor({ state: "conflict" })])[0]?.canDiscard,
      true,
    );
    for (const state of ["pending", "syncing", "failed", "stalled"] as const) {
      assert.equal(
        toQueueEntries([sor({ state })])[0]?.canDiscard,
        false,
        state,
      );
    }
  });

  it("FÉNYKÉP-soron IS lehet elvetés, mert azt is el kell tudni engedni", () => {
    /*
      A JAVITAS es az ELVETES KORE NEM UGYANAZ, es ezt kulon allitjuk. Egy
      elakadt fenykepet nem lehet ATIRNI (nincs szoveges torzse), de EL KELL
      tudni vetni -- kulonben pont az a sor ragadna bent orokre, amelyiken a
      szerelo semmit nem tud tenni.

      MI PIROSIT: ha valaki az elvetest a javitas felteteleihez kotne.
    */
    const [entry] = toQueueEntries([
      sor({ state: "conflict", operation: "upload-photo" }),
    ]);
    assert.equal(entry?.canFix, false);
    assert.equal(entry?.canDiscard, true);
  });
});

describe("az elvetett sor nem a várakozók között van", () => {
  it("saját szakaszba kerül", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A SZELETBEN, es a fordito NEM szolt rola:
      a `sectionOf` alapertelmezese a "waiting", tehat az uj allapot MAGATOL oda
      esett volna -- a szerelo azt latta volna, hogy az altala ELVETETT felvitel
      "vár feltöltésre". A `SyncState` boviteseto ez a fuggveny tovabbra is
      lefordult, tehat a typecheck hallgatasa nem volt bizonyitek.

      MI PIROSIT: az explicit ag kivetele a `sectionOf`-bol.
    */
    const [entry] = toQueueEntries([sor({ state: "discarded" })]);
    assert.equal(entry?.section, "discarded");
  });

  it("és nincs rajta se javítás, se elvetés", () => {
    const [entry] = toQueueEntries([sor({ state: "discarded" })]);
    assert.equal(entry?.canFix, false);
    assert.equal(entry?.canDiscard, false);
    assert.equal(entry?.canRetry, false);
  });
});
