import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContentService } from "./content.service.js";
import type { ContentRepository } from "./content.repository.js";

/**
 * A REPOSITORY HELYETTESÍTVE: a kérdés a DÖNTÉS, nem az adatbázis. Az
 * `moveState` alapból sikert ad, mert a legtöbb állítás azt méri, hogy
 * ELJUTUNK-e odáig.
 */
function serviceWith(
  overrides: Partial<{
    moveState: ContentRepository["moveState"];
    detail: ContentRepository["detail"];
  }> = {},
) {
  const calls: unknown[] = [];
  const repository = {
    moveState: (async (input: unknown) => {
      calls.push(input);
      return true;
    }) as ContentRepository["moveState"],
    detail: (async () => ({
      id: "c1",
    })) as unknown as ContentRepository["detail"],
    ...overrides,
  } as unknown as ContentRepository;
  return { service: new ContentService(repository), calls };
}

describe("moving a piece of content", () => {
  it("moves it when the step is allowed", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "AWAITING_APPROVAL",
      to: "READY_TO_SEND",
      actorCanApprove: true,
    });

    assert.equal(calls.length, 1);
  });

  /**
   * A TILTOTT LÉPÉS NEM ÍR SEMMIT, és a második állítás a fontosabb: az őrzőt
   * nem az bizonyítja, hogy szól, hanem hogy nem történt semmi.
   */
  it("refuses a step outside the closed list, and writes nothing", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "DRAFTING",
          to: "READY_TO_SEND",
          actorCanApprove: false,
        }),
      /nem megengedett/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * EZ A LEGFONTOSABB ÁLLÍTÁS EBBEN A SUITE-BAN. Egy ütemezett tétel MÁR A
   * FACEBOOKON áll: ha nálunk elvetnénk anélkül, hogy ott visszavonnánk, a
   * tábla „elvetve"-t mutatna, a poszt pedig kimenne a vevő elé.
   *
   * Amíg a Facebook-oldali visszavonás nincs megépítve, a helyes válasz a
   * VISSZAUTASÍTÁS: egy állapot-átírás azt hazudná, hogy a poszt nem megy ki.
   */
  it("refuses to discard a scheduled piece by rewriting our own state", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "SCHEDULED",
          to: "DISCARDED",
          discardReason: "meggondoltuk",
          actorCanApprove: false,
        }),
      /ütemezve áll a Facebookon/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * A `SENT` A KIVÉTEL: az nem a mi lépésünk, hanem a tudomásulvétele annak,
   * hogy a poszt kiment. Oda nincs mit visszavonni, tehát ez az egyetlen út
   * `SCHEDULED`-ból, ami átmegy.
   */
  it("still records that a scheduled post went out", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "SCHEDULED",
      to: "SENT",
      actorCanApprove: false,
    });

    assert.equal(calls.length, 1);
  });

  /**
   * AZ ELVETÉS OKA KÖTELEZŐ. Ok nélkül az „elvetve" annyit mond, hogy valaki
   * egyszer nemet mondott -- de nem azt, hogy miért, és a következő ember
   * ugyanazt a tételt kezdi újra.
   */
  it("will not discard anything without a reason", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "DRAFTING",
          to: "DISCARDED",
          actorCanApprove: false,
        }),
      /oka kötelező/,
    );
    assert.equal(calls.length, 0);
  });

  it("does not accept whitespace as a reason", async () => {
    const { service } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "DRAFTING",
          to: "DISCARDED",
          discardReason: "   ",
          actorCanApprove: false,
        }),
      /oka kötelező/,
    );
  });

  /**
   * HA A TÉTEL KÖZBEN ELMOZDULT, a hívó ezt MEGTUDJA. A feltételes írás nulla
   * sort módosít, és az nem csendes siker: két ember egyszerre nyithatja meg
   * ugyanazt, és a második döntés nem írhatja felül az elsőt úgy, hogy az első
   * ember továbbra is azt hiszi, az övé áll.
   */
  it("tells the caller when the piece moved underneath them", async () => {
    const { service } = serviceWith({
      moveState: (async () => false) as ContentRepository["moveState"],
    });

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "READY_TO_SEND",
          actorCanApprove: true,
        }),
      /időközben más állapotba került/,
    );
  });

  /**
   * AZ ÜTEMEZÉS HORGONYT KAP. Enélkül a „piszkozat gyújtózsinórral" szabálynak
   * nincs mihez mérnie a 25 napot, és az ütemezett poszt határidő nélkül állna
   * -- vagyis a semmittevés megint kitenné a posztot.
   */
  /**
   * ===================================================================
   * A JÓVÁHAGYÁSI KAPU. Ez a négy állítás azt méri, ami korábban SEHOL nem volt
   * mérve, és ezért csendben nyitva állt.
   * ===================================================================
   *
   * A RÉS, AMIT BEZÁRNAK: a jog korábban kizárólag a végpont választásán múlt
   * (`/move` `content.manage`, `/approve-move` `content.approve`), miközben
   * MINDKETTŐ ezt az egy metódust hívta, és a célállapot bármi lehetett. Egy
   * `content.manage` jogú szerkesztő tehát a `/move` úton kiadhatta a
   * jóváhagyást is.
   */
  it("refuses an approving step from a caller who cannot approve, and writes nothing", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "READY_TO_SEND",
          actorCanApprove: false,
        }),
      /jóváhagyói jog/,
    );
    // AZ ŐRZŐT NEM AZ BIZONYÍTJA, HOGY SZÓL, HANEM HOGY NEM TÖRTÉNT SEMMI.
    assert.equal(calls.length, 0);
  });

  /**
   * AZ ELUTASÍTÁS IS JÓVÁHAGYÓI DÖNTÉS, és ez a lépés SAJÁT döntés volt, nem
   * levezetés: az indoka a `content-state.ts` `requiresApproval` fejlécében áll.
   *
   * Röviden: az `AWAITING_APPROVAL` a jóváhagyóra vár, tehát aki nem ő, annak
   * nincs dolga a tétellel. Ha a visszaküldés `content.manage` joggal menne, egy
   * szerkesztő KIVEHETNÉ a saját tételét a jóváhagyói sorból -- nem küldené ki,
   * de a jóváhagyó soha nem látná, és ez a fajta hiba néma.
   */
  it("treats sending it back for revision as an approving step too", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "AWAITING_REVISION",
          actorCanApprove: false,
        }),
      /jóváhagyói jog/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * A BEMENET ITT SZÁNDÉKOSAN TELJES: az elvetés oka KI VAN TÖLTVE.
   *
   * Ok nélkül ez az állítás akkor is piros lenne, ha a jogot senki nem
   * ellenőrizné -- csak épp egy MÁSIK hibaüzenettel, és a teszt neve hazudna.
   * Egy állítás kalibrációjához olyan bemenet kell, ahol minden EGYÉB feltétel
   * teljesül, és csak az áll fenn, amit mérni akarunk.
   */
  it("refuses even a well-formed discard from an approval-waiting state", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "DISCARDED",
          discardReason: "a kampány elmarad",
          actorCanApprove: false,
        }),
      /jóváhagyói jog/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * ÉS A MÁSIK IRÁNY, KÜLÖNBEN A JAVÍTÁS TÚL SOKAT ZÁRNA BE: ugyanaz a lépés
   * jóváhagyói joggal ÁTMEGY. E nélkül az állítás nélkül a három fenti zöld
   * maradna akkor is, ha a kapu MINDENKIT elutasít.
   */
  it("lets an approver send it back for revision", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "AWAITING_APPROVAL",
      to: "AWAITING_REVISION",
      actorCanApprove: true,
    });

    assert.equal(calls.length, 1);
  });

  it("anchors the fuse when a piece is scheduled", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "READY_TO_SEND",
      to: "SCHEDULED",
      actorCanApprove: false,
    });

    const call = calls[0] as { scheduleAnchoredAt?: Date; scheduledFor?: Date };
    assert.ok(call.scheduleAnchoredAt instanceof Date);
    assert.ok(call.scheduledFor instanceof Date);
  });
});
