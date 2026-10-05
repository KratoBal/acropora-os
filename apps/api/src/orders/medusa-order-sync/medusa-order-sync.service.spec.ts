import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type MedusaAdminClient,
  type MedusaOrderRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import {
  MedusaOrderSyncService,
  type MedusaOrderSyncRepository,
} from "./medusa-order-sync.service.js";

function rendeles(id: string, createdAt: string): MedusaOrderRow {
  return {
    id,
    status: "pending",
    email: "vevo@példa.invalid",
    currency_code: "huf",
    total: 12_000,
    created_at: createdAt,
    updated_at: createdAt,
    sales_channel_id: null,
  };
}

/**
 * A DUPLA A VARRATOT KAPJA MEG, NEM CSAK AZT, AMIT A TESZT MEGNEZ.
 *
 * A szolgaltatas a `claimRun` visszateresebol az `id`-t HASZNALJA (a `closeRun`
 * hivasaba adja tovabb), tehat egy ures objektum "mukodne" a tesztben, es a
 * hivonal romlana el. Ezert a dupla a valodi szerzodes tipusat viseli.
 */
function duplak(options: {
  rows?: MedusaOrderRow[];
  truncated?: boolean;
  lastIngestedAt?: Date | null;
  claimAdhato?: boolean;
  mar_letezik?: Set<string>;
  listHiba?: Error;
}) {
  const naplo: string[] = [];
  const lezarasok: Array<{
    ordersSeen: number;
    createdCount: number;
    truncated: boolean;
    errorCode: string | null;
  }> = [];
  const kertSince: Array<string | null> = [];

  const client: Pick<MedusaAdminClient, "listOrders"> = {
    listOrders: async (sinceIso) => {
      kertSince.push(sinceIso);
      naplo.push("listOrders");
      if (options.listHiba) throw options.listHiba;
      return {
        rows: options.rows ?? [],
        truncated: options.truncated ?? false,
      };
    },
  };

  const repository: MedusaOrderSyncRepository = {
    lastIngestedAt: async () => options.lastIngestedAt ?? null,
    claimRun: async () => {
      naplo.push("claimRun");
      return (options.claimAdhato ?? true) ? { id: "run_egy" } : null;
    },
    createIfAbsent: async (order) => {
      naplo.push(`createIfAbsent:${order.id}`);
      return !(options.mar_letezik ?? new Set()).has(order.id);
    },
    closeRun: async (params) => {
      naplo.push("closeRun");
      lezarasok.push({
        ordersSeen: params.ordersSeen,
        createdCount: params.createdCount,
        truncated: params.truncated,
        errorCode: params.errorCode,
      });
    },
  };

  return {
    naplo,
    lezarasok,
    kertSince,
    service: new MedusaOrderSyncService(
      client as MedusaAdminClient,
      repository,
    ),
  };
}

describe("MedusaOrderSyncService.runOnce", () => {
  /**
   * A ZAR A LENYEG, ES EZ AZ EGYETLEN ALLITAS, AMI MEGFOGJA.
   *
   * Ha egy masik peldany dolgozik, ez a kor NEM hivhatja a boltot: a lehivas
   * onmagaban is munka, es ket parhuzamos kor ugyanazt vegezne el. Az
   * `ordersSeen: 0` ezt NEM bizonyitja -- egy ures valasz is nullat adna.
   * Ezert a HIVASOK SORRENDJERE allitok.
   */
  it("ha egy masik kor fut, NEM hivja a boltot", async () => {
    const { service, naplo } = duplak({ claimAdhato: false });

    const eredmeny = await service.runOnce();

    assert.equal(eredmeny.ran, false);
    assert.deepEqual(naplo, ["claimRun"], "a claimRun utan MEGALL");
  });

  it("az elso koron ido NELKUL kerdez, a kovetkezon a legutobbi utan", async () => {
    const elso = duplak({});
    await elso.service.runOnce();
    assert.deepEqual(elso.kertSince, [null]);

    const masodik = duplak({
      lastIngestedAt: new Date("2026-09-22T08:00:00.000Z"),
    });
    await masodik.service.runOnce();
    assert.deepEqual(masodik.kertSince, ["2026-09-22T08:00:00.000Z"]);
  });

  /**
   * A LATOTT ES A LETREHOZOTT KET KULONBOZO SZAM, es a kulonbseg nem hiba: a
   * lap szele ugyanarra az idobelyegre eshet, tehat egy mar atvett rendeles
   * ujra elojon. Ha a ketto egybe lenne mosva, a naplo azt allitana, hogy
   * minden korben uj rendelesek jonnek.
   */
  it("csak az UJ rendelest szamolja letrehozottnak", async () => {
    const { service, lezarasok } = duplak({
      rows: [
        rendeles("order_regi", "2026-09-22T08:00:00.000Z"),
        rendeles("order_uj", "2026-09-22T08:05:00.000Z"),
      ],
      mar_letezik: new Set(["order_regi"]),
    });

    const eredmeny = await service.runOnce();

    assert.equal(eredmeny.ordersSeen, 2, "kettot latott");
    assert.equal(eredmeny.createdCount, 1, "de csak egy UJ");
    assert.equal(lezarasok[0]!.ordersSeen, 2);
    assert.equal(lezarasok[0]!.createdCount, 1);
  });

  it("a csonkolas-jelzest TOVABBADJA a naploba", async () => {
    const { service, lezarasok } = duplak({
      rows: [rendeles("order_egy", "2026-09-22T08:00:00.000Z")],
      truncated: true,
    });

    const eredmeny = await service.runOnce();

    assert.equal(eredmeny.truncated, true);
    assert.equal(lezarasok[0]!.truncated, true);
  });

  /**
   * KONTROLL a csonkolashoz: hatar alatt NE alljon igazra. Enelkul egy
   * `truncated: true` konstans is atmenne a fenti alliteson.
   */
  it("KONTROLL: csonkolas nelkul hamis marad", async () => {
    const { service, lezarasok } = duplak({
      rows: [rendeles("order_egy", "2026-09-22T08:00:00.000Z")],
    });

    const eredmeny = await service.runOnce();

    assert.equal(eredmeny.truncated, false);
    assert.equal(lezarasok[0]!.truncated, false);
  });

  /**
   * A HIBA UTAN A ZARNAK FEL KELL SZABADULNIA.
   *
   * Egy bent ragadt zar ugyanaz, mint egy vegtelen futas: a kovetkezo kor
   * sosem indulna el, es SEMMI nem szolna rola -- a naplo utolso sora egy
   * `RUNNING` allapotu kor lenne, orokre. Ezert a `closeRun` hivasara
   * allitok, nem csak arra, hogy a kivetel tovabb szall.
   */
  it("hiba eseten is LEZARJA a kort, es a hibakodot naplozza", async () => {
    const { service, naplo, lezarasok } = duplak({
      listHiba: new TypeError("a bolt nem valaszolt"),
    });

    await assert.rejects(() => service.runOnce(), TypeError);

    assert.ok(naplo.includes("closeRun"), "a zar felszabadul");
    assert.equal(lezarasok[0]!.errorCode, "TypeError");
  });

  /**
   * KONTROLL: sikeres koron a hibakod NULL. Enelkul egy konstans hibakod is
   * atmenne a fenti alliteson.
   */
  it("KONTROLL: sikeres koron nincs hibakod", async () => {
    const { service, lezarasok } = duplak({
      rows: [rendeles("order_egy", "2026-09-22T08:00:00.000Z")],
    });

    await service.runOnce();

    assert.equal(lezarasok[0]!.errorCode, null);
  });

  /**
   * A HIVASOK SORRENDJE, ES MIERT NEM A DARABSZAM.
   *
   * A kor: zar -> lehivas -> atvetel rendelesenkent -> lezaras. A `createIfAbsent`
   * az, ami a rendelest ES a hozza tartozo keszletmozgast egy tranzakcioban
   * viszi (lasd a Prisma-megvalositast); a szolgaltatas ezt nem bontja szet,
   * mert a ketto kozott nem szabad koztes allapotnak lennie.
   *
   * Ez az allitas a SORRENDRE megy, nem a hivasok szamara: egy szam akkor is
   * stimmelne, ha a lezaras az atvetel ELE kerulne -- es akkor egy hiba utan
   * egy mar lezart kor nyitna ujra.
   */
  it("a kor sorrendje: zar, lehivas, atvetel, lezaras", async () => {
    const { service, naplo } = duplak({
      rows: [rendeles("order_egy", "2026-09-22T08:00:00.000Z")],
    });

    await service.runOnce();

    assert.deepEqual(naplo, [
      "claimRun",
      "listOrders",
      "createIfAbsent:order_egy",
      "closeRun",
    ]);
  });
});
