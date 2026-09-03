import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saveAssetOrQueue } from "./save-or-queue";

/**
 * A NEGY KIMENET, ES KETTO KOZULUK UGYANUGY NEZ KI A TELEFONON.
 *
 *   saved     -> a szerver elfogadta
 *   queued    -> nem ertuk el a szervert, a felvitel var
 *   lost      -> a sorba tetel is elbukott: a felvitel SEHOL nincs
 *   rejected  -> a szerver VALASZOLT es elutasitotta -- sorba TENNI HIBA lenne
 */

const alap = {
  statusOf: (e: unknown) =>
    typeof e === "object" && e && "status" in e
      ? ((e as { status: number }).status ?? null)
      : null,
  checkMessage: "Ezt a kódot 400 eszköz ellen ellenőriztem.",
};

describe("mentés vagy sorba tétel", () => {
  it("térerővel a SZERVERRE megy, és nem kerül a sorba", async () => {
    let sorbaTettek = false;
    const out = await saveAssetOrQueue({
      ...alap,
      createAsset: () => Promise.resolve({ id: "asset_9" }),
      enqueue: () => {
        sorbaTettek = true;
        return Promise.resolve({ ok: true as const, operationId: "op" });
      },
    });
    assert.equal(out.type, "saved");
    // ES NEM TETTUK SORBA. Enelkul egy "mindig sorba tesz" valtozat is
    // atmenne, es minden felvitel varakozna, pedig a szerver ott van.
    assert.equal(sorbaTettek, false);
  });

  it("hálózat nélkül a SORBA kerül", async () => {
    const out = await saveAssetOrQueue({
      ...alap,
      createAsset: () => Promise.reject(new Error("Network request failed")),
      enqueue: () => Promise.resolve({ ok: true as const, operationId: "op1" }),
    });
    assert.equal(out.type, "queued");
    assert.equal(out.type === "queued" && out.operationId, "op1");
  });

  it("a szerver ELUTASÍTÁSA NEM kerül sorba", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS. Egy 4xx nem lesz jobb attol, hogy sorba
      tesszuk: ugyanazt a valaszt adna ujra es ujra, kozben a felulet
      VARAKOZAST mutatna, es a kollega azt hinne, hogy a felvitel uton van.
    */
    let sorbaTettek = false;
    const out = await saveAssetOrQueue({
      ...alap,
      createAsset: () =>
        Promise.reject(Object.assign(new Error("hibás adat"), { status: 422 })),
      enqueue: () => {
        sorbaTettek = true;
        return Promise.resolve({ ok: true as const, operationId: "op" });
      },
    });
    assert.equal(out.type, "rejected");
    assert.equal(sorbaTettek, false);
  });

  it("ha a SORBA TÉTEL is elbukik, a válasz ELVESZETT, nem 'vár'", async () => {
    const out = await saveAssetOrQueue({
      ...alap,
      createAsset: () => Promise.reject(new Error("Network request failed")),
      enqueue: () =>
        Promise.resolve({ ok: false as const, error: "megtelt a tároló" }),
    });
    assert.equal(out.type, "lost");
    assert.match(out.type === "lost" ? out.message : "", /elveszett/);
  });
});
