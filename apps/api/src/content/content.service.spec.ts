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
      () => service.move({ id: "c1", from: "DRAFTING", to: "READY_TO_SEND" }),
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

    await service.move({ id: "c1", from: "SCHEDULED", to: "SENT" });

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
      () => service.move({ id: "c1", from: "DRAFTING", to: "DISCARDED" }),
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
        }),
      /időközben más állapotba került/,
    );
  });

  /**
   * AZ ÜTEMEZÉS HORGONYT KAP. Enélkül a „piszkozat gyújtózsinórral" szabálynak
   * nincs mihez mérnie a 25 napot, és az ütemezett poszt határidő nélkül állna
   * -- vagyis a semmittevés megint kitenné a posztot.
   */
  it("anchors the fuse when a piece is scheduled", async () => {
    const { service, calls } = serviceWith();

    await service.move({ id: "c1", from: "READY_TO_SEND", to: "SCHEDULED" });

    const call = calls[0] as { scheduleAnchoredAt?: Date; scheduledFor?: Date };
    assert.ok(call.scheduleAnchoredAt instanceof Date);
    assert.ok(call.scheduledFor instanceof Date);
  });
});
