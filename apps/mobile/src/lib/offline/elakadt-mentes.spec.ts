import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { PickedFile } from "../api/picked-image";
import {
  initialConnectivity,
  nextConnectivity,
  nextWakeAt,
  OFFLINE_CONFIRM_MS,
  stalledConnectivity,
  STALL_HOLD_MS,
  type ConnectivityState,
} from "./connectivity-state";
import { uploadOrQueuePhotos } from "./photo-upload-or-queue";
import { saveOrQueue, type SaveConnectivity } from "./save-or-queue";

/**
 * AZ IOS-EN POROGO MENTES (acrobot 25730 es 25731, 2026-10-01).
 *
 * Terero nelkul iOS-en a matrica- es a fenykep-mentes porgott, se mentes, se
 * sor; Androidon nem, es iOS-en sem mindig. A forrasbol mert ok: az iOS a
 * NetInfo sajat probajaval akar 75 masodpercig online-nak mondja magat, es
 * ezalatt minden mentes a hivas idokorlatjaig var (20 masodperc, fenykepnel
 * 120). Hogy elakad-e, az azon mulik, mikor futott a proba utoljara -- ezert
 * szakaszos.
 *
 * KET IRANY, ES MIND A KETTO ALLITAS:
 *   - egy idokorlatba futo hivas a SORBA esik, es a kovetkezo mentes mar meg
 *     sem probalja a szervert;
 *   - terero mellett a mentes VALTOZATLANUL a szerverre megy.
 */

const CHECK = "ellenőrizve";

const alap = {
  statusOf: (e: unknown) =>
    typeof e === "object" && e && "status" in e
      ? ((e as { status: number }).status ?? null)
      : null,
  describeWrite: (
    result: { ok: true; operationId: string } | { ok: false; error: string },
  ) =>
    result.ok
      ? {
          type: "queued" as const,
          operationId: result.operationId,
          message: CHECK,
        }
      : { type: "queue-failed" as const, message: result.error },
};

/**
 * A KESZULEK KAPCSOLATA, A VALODI ALLAPOTGEPPEL ES KEZZEL LEPTETETT ORAVAL. A
 * `connectivity.ts` ugyanezt a ket fuggvenyt koti a NetInfo-ra; itt az ora a
 * mienk, tehat a tartas lejarta is merheto.
 */
function keszulek(): SaveConnectivity & {
  ora: number;
  allapot: ConnectivityState;
  jelentes(online: boolean): void;
  telik(ms: number): void;
} {
  const k = {
    ora: 1_000,
    allapot: initialConnectivity,
    offline: () => !k.allapot.online,
    unreachable: () => {
      k.allapot = stalledConnectivity(k.allapot, k.ora);
    },
    jelentes: (online: boolean) => {
      k.allapot = nextConnectivity(k.allapot, k.ora, {
        isConnected: true,
        isInternetReachable: online,
      });
    },
    telik: (ms: number) => {
      k.ora += ms;
      k.allapot = nextConnectivity(k.allapot, k.ora);
    },
  };
  return k;
}

/**
 * EGY HIVAS, AMI SOHA NEM VALASZOL, CSAK AZ IDOKORLATJA SZAKITJA MEG -- pont
 * ugy, ahogy az `apiRequest` teszi: a megszakitas HTTP-statusz nelkuli hibara
 * fordul. A korlat itt 20 ezredmasodperc, nem 20 masodperc.
 */
const elakadoHivas = <T>(): Promise<T> =>
  new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error("Aborted")), 20),
  );

describe("az elakadt mentés", () => {
  // MI PIROSIT: ha az elakadas nem irna vissza a kapcsolatba (`unreachable`
  // hivasa kimarad), a masodik mentes ujra a szervert probalna, es ujra varna.
  it("az időkorlátba futó hívás a sorba esik, és a következő mentés már meg sem próbálja a szervert", async () => {
    const k = keszulek();
    let hivasok = 0;
    const elso = await saveOrQueue({
      ...alap,
      connectivity: k,
      save: () => {
        hivasok += 1;
        return elakadoHivas();
      },
      enqueue: async () => ({ ok: true as const, operationId: "op-1" }),
    });
    assert.equal(elso.type, "queued");
    assert.equal(hivasok, 1);
    assert.equal(k.allapot.online, false);

    const masodik = await saveOrQueue({
      ...alap,
      connectivity: k,
      save: () => {
        hivasok += 1;
        return elakadoHivas();
      },
      enqueue: async () => ({ ok: true as const, operationId: "op-2" }),
    });
    assert.equal(masodik.type, "queued");
    // A LENYEG: a masodik mentes NEM hivta a szervert, tehat nem is vart.
    assert.equal(hivasok, 1);
  });

  // MI PIROSIT: ha a megerositett offline allapot nem kerulne a mentes ele, a
  // szerver hivasa elindulna.
  it("ha a készülék megerősítetten offline, a szervert meg sem hívja", async () => {
    const k = keszulek();
    k.jelentes(false);
    k.telik(OFFLINE_CONFIRM_MS);
    assert.equal(k.allapot.online, false);

    let hivott = false;
    const out = await saveOrQueue({
      ...alap,
      connectivity: k,
      save: async () => {
        hivott = true;
        return { id: "sosem" };
      },
      enqueue: async () => ({ ok: true as const, operationId: "op" }),
    });
    assert.equal(out.type, "queued");
    assert.equal(hivott, false);
  });

  /**
   * A MASIK IRANY. Enelkul a fenti ket allitas akkor is zold lenne, ha a mentes
   * MINDIG a sorba tenne -- es akkor terero mellett semmi nem menne fel.
   */
  it("térerővel a szerverre megy, és nem billenti offline-ba a készüléket", async () => {
    const k = keszulek();
    const out = await saveOrQueue({
      ...alap,
      connectivity: k,
      save: async () => ({ id: "asset_1" }),
      enqueue: async () => {
        throw new Error("nem szabadna sorba tenni");
      },
    });
    assert.deepEqual(out, { type: "saved", id: "asset_1" });
    assert.equal(k.allapot.online, true);
  });

  /**
   * A SZERVER VALASZOLT: az nem elakadas. Ha egy 409 vagy 422 offline-ba
   * billentene, a kovetkezo, JO mentes is a sorba kerulne.
   */
  it("a szerver elutasítása nem elakadás", async () => {
    const k = keszulek();
    const out = await saveOrQueue({
      ...alap,
      connectivity: k,
      save: () =>
        Promise.reject(Object.assign(new Error("ütközés"), { status: 409 })),
      enqueue: async () => ({ ok: true as const, operationId: "op" }),
    });
    assert.equal(out.type, "rejected");
    assert.equal(k.allapot.online, true);
  });

  /**
   * A TARTAS VEGE: offline-bol online-ba valtunk, es csak ez a valtas uriti a
   * sort (`useQueueDrain`). Ha a tartas sosem jarna le, a sorba tett mentesek
   * a kovetkezo app-inditasig allnanak.
   */
  it("a tartás lejártával a mentés újra a szerverrel kezd", async () => {
    const k = keszulek();
    k.unreachable();
    k.telik(STALL_HOLD_MS - 1);
    assert.equal(k.allapot.online, false);
    k.telik(1);
    assert.equal(k.allapot.online, true);

    let hivott = false;
    await saveOrQueue({
      ...alap,
      connectivity: k,
      save: async () => {
        hivott = true;
        return { id: "x" };
      },
      enqueue: async () => ({ ok: true as const, operationId: "op" }),
    });
    assert.equal(hivott, true);
  });
});

const kep = (nev: string): PickedFile => ({
  uri: `file:///${nev}`,
  name: nev,
  type: "image/jpeg",
});

describe("az elakadt fénykép-feltöltés", () => {
  // MI PIROSIT: ha a feltoltes nem irna vissza a kapcsolatba, vagy offline-ban
  // is a szervert probalna -- a fenykep 120 masodperces korlattal megy.
  it("az időkorlátba futó feltöltés a sorba esik, a következő meg sem próbálja", async () => {
    const k = keszulek();
    let feltoltesek = 0;
    const kuld = () =>
      uploadOrQueuePhotos({
        files: [kep("a.jpg"), kep("b.jpg")],
        connectivity: k,
        upload: () => {
          feltoltesek += 1;
          return elakadoHivas();
        },
        enqueue: async () => true,
        statusOf: () => null,
        describeRejection: () => "elutasítva",
      });

    assert.deepEqual(await kuld(), { type: "queued", queued: 2, failed: 0 });
    assert.deepEqual(await kuld(), { type: "queued", queued: 2, failed: 0 });
    assert.equal(feltoltesek, 1);
  });

  it("térerővel feltölt, és nem tesz sorba", async () => {
    const k = keszulek();
    let sorba = 0;
    const out = await uploadOrQueuePhotos({
      files: [kep("a.jpg")],
      connectivity: k,
      upload: async () => ({ count: 1 }),
      enqueue: async () => {
        sorba += 1;
        return true;
      },
      statusOf: () => null,
      describeRejection: () => "elutasítva",
    });
    assert.deepEqual(out, { type: "uploaded", count: 1 });
    assert.equal(sorba, 0);
    assert.equal(k.allapot.online, true);
  });
});

describe("a tartás és a készülék saját jelentései", () => {
  it("egy online jelentés a tartás alatt azonnal feloldja", () => {
    const tartva = stalledConnectivity(initialConnectivity, 1000);
    const vissza = nextConnectivity(tartva, 2000, {
      isConnected: true,
      isInternetReachable: true,
    });
    assert.equal(vissza.online, true);
    assert.equal(vissza.stalledUntil, null);
  });

  // MI PIROSIT: ha a tartas vege eldobna a kozben indult offline sorozatot,
  // egy valodi kapcsolat-vesztes utan visszaternenk online-ba.
  it("a tartás alatt indult offline sorozat a tartás után is megmarad", () => {
    let s = stalledConnectivity(initialConnectivity, 1000);
    s = nextConnectivity(s, 2000, {
      isConnected: true,
      isInternetReachable: false,
    });
    s = nextConnectivity(s, 1000 + STALL_HOLD_MS);
    assert.equal(s.online, false);
    assert.equal(s.stalledUntil, null);
  });

  it("az időzítő a tartás végére ébred", () => {
    const tartva = stalledConnectivity(initialConnectivity, 1000);
    assert.equal(nextWakeAt(tartva), 1000 + STALL_HOLD_MS);
    // KONTROLL: nyugalmi allapotban nincs mire ebredni.
    assert.equal(nextWakeAt(initialConnectivity), null);
  });
});

/**
 * MINDEN MENTES ATADJA A KAPCSOLATOT. Szovegbol, mert a kepernyok
 * React-komponensek, es ebben a csomagban nincs renderelo -- a hatar ugyanaz,
 * mint a tobbi ilyen allitasnak: azt meri, hogy a KOTES ott van.
 *
 * MI PIROSIT: egy uj vagy atirt mentes, ami a kapcsolatot nem adja at -- az
 * iOS-en ugyanugy porogne, mint a matrica-mentes 2026-10-01-ig.
 */
describe("a képernyők bekötése", () => {
  /** Az OSSZES kepernyo, nem egy kezzel irt lista: egy uj mentes is ide esik. */
  const fajlok = (konyvtar: string): string[] =>
    readdirSync(konyvtar, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? fajlok(join(konyvtar, e.name))
        : e.name.endsWith(".tsx")
          ? [join(konyvtar, e.name)]
          : [],
    );

  it("minden saveOrQueue és uploadOrQueuePhotos hívás átadja a kapcsolatot", () => {
    let osszes = 0;
    for (const ut of fajlok("src/app")) {
      const forras = readFileSync(ut, "utf8");
      const hivasok = forras.match(/(saveOrQueue|uploadOrQueuePhotos)\(\{/g);
      if (!hivasok) continue;
      const kotesek = forras.match(/connectivity: deviceConnectivity,/g);
      assert.equal(
        kotesek?.length ?? 0,
        hivasok.length,
        `${ut}: nem minden mentés kapja meg a kapcsolatot`,
      );
      osszes += hivasok.length;
    }
    // KONTROLL: a bejaras tenyleg megtalalta a menteseket (2026-10-01-en 9),
    // kulonben egy ures bejaras mellett a fenti ciklus semmit nem allitana.
    assert.equal(osszes, 9);
  });
});
