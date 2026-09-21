import assert from "node:assert/strict";
import type { AuthenticatedUser } from "@acropora/types";
import { describe, it } from "node:test";

import type {
  ServiceJobStatus,
  WorksheetVersionStatus,
} from "@acropora/database";

import { serviceJobDetailRow } from "../testing/service-job-detail-row.fixture.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A REPOSITORY HELYETTESÍTVE, mert a kérdés a DÖNTÉS, nem az adatbázis:
 * engedjük-e a lépést, és mit mondunk, ha nem.
 */
function serviceWith(behaviour: {
  status: ServiceJobStatus | null;
  moved?: boolean;
  /** A LEPES UTANI allapot, ahogy a tarolo mar latja. */
  utana?: ServiceJobStatus;
  /** A jegy munkalapjai, ahogy a lezarasi kapu latja oket. */
  lapok?: {
    id: string;
    number: string | null;
    hiddenAt: Date | null;
    versions: { status: WorksheetVersionStatus }[];
  }[];
}) {
  const calls: unknown[] = [];
  // A VARRAT A VALODI SZERZODES TIPUSAT KAPJA, nem `unknown`-t: igy a fordito
  // szol, ha a repository szignaturaja elmozdul a duplatol. Egy `as unknown as`
  // eppen azt az egy ellenorzest kapcsolna ki, amiert a dupla letezik.
  //
  // A `detail` ES A `documentRemovals` AZERT SZEREPEL ITT, mert a lepes
  // valasza 2026-09-17 ota a TELJES reszletlap: a metodus a sajat `detail()`
  // hivasan megy tovabb. Enelkul a dupla pont azt nem adna meg, amit a HIVO
  // hasznal -- a sajat allitasai attol meg zoldek maradnanak.
  const repository: Pick<
    ServiceJobsRepository,
    | "statusOf"
    | "move"
    | "detail"
    | "documentRemovals"
    | "worksheetSignatureStates"
  > = {
    statusOf: async () => behaviour.status,
    /*
      A LEZARASI KAPU EZT OLVASSA. Alapbol URES: a jegyek tobbsegehez nincs lap,
      es Balazs 3. szabalya szerint az ilyen jegy lezarhato. Amelyik allitas a
      kaput meri, az adja meg a `lapok` erteket.
    */
    worksheetSignatureStates: async () => behaviour.lapok ?? [],
    move: async (input) => {
      calls.push(input);
      return behaviour.moved === false ? { ok: false } : { ok: true };
    },
    detail: async () =>
      serviceJobDetailRow(
        behaviour.utana === undefined ? {} : { status: behaviour.utana },
      ),
    documentRemovals: async () => [],
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    calls,
  };
}

/**
 * A HIVO HATOKORE MOSTANTOL ARGUMENTUM, ES EZ NEM DISZITES.
 *
 * Az irasi utak 2026-09-14 ota a hivo hatokoret nezik, MIELOTT irnanak.
 * Ezek az allitasok a BELSO agat merik -- a partner-hatokor sajat
 * fajlban all (`service-jobs.write-scope.spec.ts`).
 */
const BELSOS = { id: "user-1" } as AuthenticatedUser;

describe("egy lépés a hibajegyen", () => {
  it("a megengedett lépés átmegy, és a naplóhoz továbbadja, honnan hova", async () => {
    const { service, calls } = serviceWith({ status: "NEW" });

    await service.move("job-1", { to: "TRIAGED" }, "user-1", BELSOS);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      id: "job-1",
      from: "NEW",
      to: "TRIAGED",
      note: null,
      actorUserId: "user-1",
    });
  });

  /**
   * AZ ELUTASÍTÁS MEGNEVEZI, MI MEHETNE HELYETTE.
   *
   * Egy puszta „nem lehet" arra kényszerítené a felhasználót, hogy sorra
   * próbálgassa a gombokat - a válasz pedig úgyis a szerveren áll.
   *
   * ÉS A TILTOTT LÉPÉS NEM ÉR EL AZ ADATBÁZISIG: ezt külön állítjuk, mert egy
   * őrzőt nem az bizonyít, hogy szól, hanem hogy nem történt semmi.
   */
  it("a tiltott lépést elutasítja, megnevezi a lehetségeseket, és nem ír", async () => {
    const { service, calls } = serviceWith({ status: "NEW" });

    await assert.rejects(
      () => service.move("job-1", { to: "COMPLETED" }, "user-1", BELSOS),
      /TRIAGED/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * A LEZARASI KAPU -- BALAZS SZABALYAI, 2026-09-18 18:06.
   *
   * A SZABALYT a `common/worksheet-signature-gate.spec.ts` meri; EZEK a
   * BEKOTEST. A ketto kulon romolhat el, es a szakadas nema: a tiszta fuggveny
   * zolden all, kozben a kaput senki nem hivja.
   */
  it("alairatlan lap folott NEM zarhato le, megnevezi a lapot, es NEM ir", async () => {
    const { service, calls } = serviceWith({
      status: "IN_PROGRESS",
      lapok: [
        {
          id: "ws-1",
          number: "BIO-2026-004",
          hiddenAt: null,
          versions: [{ status: "AWAITING_SIGNATURE" }],
        },
      ],
    });

    await assert.rejects(
      () => service.move("job-1", { to: "COMPLETED" }, "user-1", BELSOS),
      /BIO-2026-004/,
    );
    // AZ ORZOT NEM AZ BIZONYITJA, HOGY SZOL, HANEM HOGY NEM TORTENT SEMMI.
    assert.equal(calls.length, 0);
  });

  it("a REJTETT alairatlan lap is visszatartja, es a mondat kimondja, hogy rejtett", async () => {
    const { service, calls } = serviceWith({
      status: "IN_PROGRESS",
      lapok: [
        {
          id: "ws-2",
          number: "BIO-2026-005",
          hiddenAt: new Date("2026-09-20T10:00:00Z"),
          versions: [{ status: "DRAFT" }],
        },
      ],
    });

    await assert.rejects(
      () => service.move("job-1", { to: "COMPLETED" }, "user-1", BELSOS),
      (hiba: unknown) => {
        const uzenet = (hiba as { message: string }).message;
        assert.match(uzenet, /BIO-2026-005 \(rejtett\)/);
        // A JEGY ALATT NEM LATSZIK: a mondat megmondja, HOL talalja meg.
        assert.match(uzenet, /Rejtettek is/);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });

  it("munkalap nelkul lezarhato (Balazs 3. szabalya)", async () => {
    const { service, calls } = serviceWith({
      status: "IN_PROGRESS",
      lapok: [],
      utana: "COMPLETED",
    });

    await service.move("job-1", { to: "COMPLETED" }, "user-1", BELSOS);
    assert.equal(calls.length, 1);
  });

  it("alairt lap folott lezarhato", async () => {
    const { service, calls } = serviceWith({
      status: "IN_PROGRESS",
      lapok: [
        {
          id: "ws-3",
          number: "BIO-2026-006",
          hiddenAt: null,
          versions: [{ status: "SIGNED" }],
        },
      ],
      utana: "COMPLETED",
    });

    await service.move("job-1", { to: "COMPLETED" }, "user-1", BELSOS);
    assert.equal(calls.length, 1);
  });

  /**
   * A KAPU HATARA, NEV SZERINT. Az elallt jegyre epp az a jellemzo, hogy NEM
   * lett belole munka -- ha a kapu arra is allna, egy tevedesbol nyitott jegy
   * bent ragadna egy felig kitoltott lap miatt. Ez az allitas azert all itt,
   * hogy a kapu kesobbi szelesitese NE csendben tortenjen.
   */
  it("az ELALLAS nem esik a kapu ala, alairatlan lap mellett sem", async () => {
    const { service, calls } = serviceWith({
      status: "SCHEDULED",
      lapok: [
        {
          id: "ws-4",
          number: "BIO-2026-007",
          hiddenAt: null,
          versions: [{ status: "DRAFT" }],
        },
      ],
      utana: "CANCELLED",
    });

    await service.move("job-1", { to: "CANCELLED" }, "user-1", BELSOS);
    assert.equal(calls.length, 1);
  });

  it("végállapotban azt mondja, hogy nincs több lépés", async () => {
    const { service } = serviceWith({ status: "CANCELLED" });

    await assert.rejects(
      () => service.move("job-1", { to: "NEW" }, "user-1", BELSOS),
      /nincs több lépése/,
    );
  });

  /**
   * HA KÖZBEN MÁS LÉPETT, NEM ÍRJUK FELÜL CSENDBEN. A tárolóréteg a `from`
   * értéket feltételként használja; ha nem talált sort, az azt jelenti, hogy
   * a jegy elmozdult alattunk.
   */
  it("elmozdult jegynél ütközést jelez, nem sikert", async () => {
    const { service } = serviceWith({ status: "NEW", moved: false });

    await assert.rejects(
      () => service.move("job-1", { to: "TRIAGED" }, "user-1", BELSOS),
      /időközben/,
    );
  });

  /**
   * A CSUPA SZOKOZ UGYANAZ, MINT A SEMMI, ES NEM ELUTASITAS: a megjegyzes
   * ELHAGYHATO (Balazs dontese, 2026-09-03), tehat a lepes atmegy -- csak a
   * jegy tortenetebe `null` kerul, nem egy ures sor.
   *
   * KET ALLITAS EGYUTT, ES SZANDEKOSAN: a lepes MEGTORTENT (a hivas eljutott a
   * repositoryig), ES a szoveg `null` lett. Az elso nelkul egy visszautasitas
   * is teljesitene a masodikat.
   */
  it("a csupa szóközből álló megjegyzés null-ként megy át, a lépés nem akad el", async () => {
    const { service, calls } = serviceWith({ status: "NEW" });

    await service.move(
      "job-1",
      { to: "CANCELLED", note: "   " },
      "user-1",
      BELSOS,
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      id: "job-1",
      from: "NEW",
      to: "CANCELLED",
      note: null,
      actorUserId: "user-1",
    });
  });

  /**
   * A VEGALLAPOTBA INDOK NELKUL IS LEHET LEPNI. Kulon allitas, mert a
   * korabbi valtozat epp ezt tiltotta: ha valaki ujra bevezetne egy
   * atmenet-fuggo kotelezoseget, ez a sor pirosodik, es nem a felhasznalo
   * talalkozik vele eloszor.
   */
  it("végállapotba megjegyzés nélkül is lehet lépni", async () => {
    const { service, calls } = serviceWith({ status: "TRIAGED" });

    await service.move("job-1", { to: "CANCELLED" }, "user-1", BELSOS);

    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { note: unknown }).note, null);
  });

  it("indokkal átmegy, és a szöveg eljut a naplóhoz", async () => {
    const { service, calls } = serviceWith({ status: "TRIAGED" });

    await service.move(
      "job-1",
      { to: "WAITING_FOR_PARTS", note: "  Szivattyú, hétfőre ígérik.  " },
      "user-1",
      BELSOS,
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      id: "job-1",
      from: "TRIAGED",
      to: "WAITING_FOR_PARTS",
      note: "Szivattyú, hétfőre ígérik.",
      actorUserId: "user-1",
    });
  });

  it("nem létező jegyre nem találhatót mond", async () => {
    const { service } = serviceWith({ status: null });

    await assert.rejects(
      () => service.move("hianyzik", { to: "TRIAGED" }, "user-1", BELSOS),
      /nem található/,
    );
  });

  /**
   * A VÁLASZ A TELJES RÉSZLETLAP, NEM NYUGTA.
   *
   * MÉRT HIBA, 2026-09-17 (Balázs jelentése): a telefonon a léptetés KILÉPTETTE
   * az alkalmazást. A kliens `ServiceJobDetail` típusúnak deklarálta a választ,
   * a szerver viszont `{ ok: true }`-t küldött; a képernyő ezt tette a
   * gyorsítótárba, és a következő kirajzolás `detail.assets.length` értéken
   * állt meg. React Native-ben ez nem hibaüzenet, hanem kilépés.
   *
   * MI PIROSÍT: bármilyen visszatérés, ami nem a részletlap. Egy nyugtán a
   * `timeline` és az `allowedSteps` nem is létezik, tehát az alábbi három
   * állítás közül mindhárom elbukik rajta.
   *
   * MIÉRT NEM ELÉG AZ, HOGY A `detail()` SAJÁT SPECJE ZÖLD: az a metódust
   * méri, ezt a BEKÖTÉST. A kettő között pontosan az a lépés áll, ami élesben
   * hiányzott.
   */
  it("a lépés a friss részletlapot adja vissza, nem nyugtát", async () => {
    const { service } = serviceWith({ status: "NEW", utana: "TRIAGED" });

    const valasz = await service.move(
      "job-1",
      { to: "TRIAGED" },
      "user-1",
      BELSOS,
    );

    // A LEPES UTANI ALLAPOT: a valasz a tarolotol frissen olvasott sorbol
    // epul, nem a keresben kuldott cel-allapotbol. Enelkul egy valasz, ami
    // egyszeruen visszatukrozi a bemenetet, ugyanigy zold lenne.
    assert.equal(valasz.status, "TRIAGED");
    // A NAPLO A LEPES BIZONYITEKA, es a telefon ebbol rajzolja a lap aljat.
    assert.ok(valasz.timeline.length > 0);
    // A KOVETKEZO LEPESEKET IS VISZI: enelkul a kepernyo gombjai a lepes utan
    // egy ujabb lekerdezesig a REGI allapot szerint allnanak.
    assert.ok(Array.isArray(valasz.allowedSteps));
  });
});
