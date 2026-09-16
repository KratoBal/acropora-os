import assert from "node:assert/strict";
import type { AuthenticatedUser } from "@acropora/types";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A JEGY AZ ESZKÖZBŐL SZÜLETIK, HA A TELEFON NEM TUD TÖBBET MONDANI.
 *
 * === MIÉRT A SZERVER VEZETI LE ===
 *
 * A webes űrlapon a partnert, a helyszínt és az eszközöket a SEMMIBŐL kell
 * kiválasztani -- ezért áll ott három választó, és ezért 575 soros. A helyszínen
 * viszont a szerelő EGY eszköz előtt áll, és abból a három már következik.
 *
 * A levezetés azért a SZERVEREN van (acrobot döntése, 2026-09-16), mert a
 * szállítói eszköz partnere a `Supplier.customerId` TÜKÖR-sor, ami a partner
 * BELSŐ részlete. Kliens-szerződéssé téve nem lehetne megváltoztatni anélkül,
 * hogy a telefon elromoljon.
 */
function serviceWith(behaviour: {
  placement?: { customerId: string | null; departmentId: string | null } | null;
  outside?: string[];
  belongs?: boolean;
}) {
  const created: unknown[] = [];
  /**
   * A VARRAT A VALODI SZERZODES TIPUSAT KAPJA. Ha barmelyik tarolo-metodus
   * szignaturaja elmozdul, a fordito szoljon -- ne a felhasznalo.
   */
  const repository: Pick<
    ServiceJobsRepository,
    | "placementOfAsset"
    | "assetsOutsideDepartment"
    | "departmentBelongsToCustomer"
    | "lastNumberOfYear"
    | "create"
  > = {
    placementOfAsset: async () =>
      behaviour.placement === undefined ? null : behaviour.placement,
    assetsOutsideDepartment: async () => behaviour.outside ?? [],
    departmentBelongsToCustomer: async () => behaviour.belongs ?? true,
    // A VARRAT VALODI TIPUSA: `string | null`, nem szam -- a fordito szolt,
    // es ez epp az a hiba, amiert a `Pick<>` alak itt all.
    lastNumberOfYear: async () => null,
    create: async (input) => {
      created.push(input);
      return { id: "job-1", jobNumber: "SZ-2026-0001" } as never;
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    created,
  };
}

const BELSOS = { id: "user-1" } as AuthenticatedUser;

function torzs(over: Record<string, unknown> = {}) {
  return { title: "Szivattyú zúg", ...over } as never;
}

describe("a jegy az eredet-eszközből veszi az elhelyezését", () => {
  it("vevő tulajdonosnál a partner és a helyszín is megjön", async () => {
    const { service, created } = serviceWith({
      placement: { customerId: "customer-1", departmentId: "dep-1" },
    });

    await service.create(torzs({ originAssetId: "asset-1" }), BELSOS.id);

    /**
     * TELJES OBJEKTUM-EGYEZES, NEM MEZONKENT: igy egy UJ mezo is pirosra
     * viszi, nem csak egy megvaltozott. A `jobNumber` itt MELLEKES -- a
     * szamozasnak sajat specje van --, de a kihagyasa gyengitene az allitast.
     * (Az elso alakomban `SZ-` elotagot tippeltem; a valodi `HJ-`, es a teszt
     * javitott ki.)
     */
    assert.deepEqual(created[0], {
      jobNumber: "HJ-2026-001",
      title: "Szivattyú zúg",
      description: null,
      customerId: "customer-1",
      departmentId: "dep-1",
      assetIds: ["asset-1"],
      actorUserId: "user-1",
      assigneeIds: [],
      /*
        A HELYSZINI BEJELENTES KULCSA, ITT `null`: ez a fixture nem kuld ilyet
        (a webes felvitel sem kuld). A mezo MEGIS itt all, mert a teljes
        objektum-egyezes a lenyeg -- a tarolo ezt az erteket irja a jegyre, es
        egy kihagyott mezo eppen azt a fajta csuszast engedne at, amit a
        `mobile-request-body.spec.ts` ma este megfogott.
      */
      clientOperationId: null,
    });
  });

  /**
   * A SZALLITOI ESZKOZ PARTNERE A TUKOR-SOR -- ES EZ A TAROLO DOLGA.
   *
   * A szolgaltatas nem tudja, es nem is kell tudnia, hogy az ertek honnan jott:
   * a `placementOfAsset` mar a `Customer` azonositot adja vissza. Ez az allitas
   * azt koti le, hogy a szolgaltatas ATVESZI, amit kap.
   */
  it("a tárolótól kapott partnert átveszi, bármelyik oldalról jött", async () => {
    const { service, created } = serviceWith({
      placement: { customerId: "mirror-customer", departmentId: null },
    });

    await service.create(torzs({ originAssetId: "asset-2" }), BELSOS.id);

    assert.equal(
      (created[0] as { customerId: string | null }).customerId,
      "mirror-customer",
    );
  });

  /**
   * EZ AZ AZ ALLITAS, AMI A LEGTOBBET ERI A HELYSZINEN.
   *
   * Az `Asset.departmentId` OPCIONALIS, tehat a helyszin nelkuli eszkoz
   * normalis allapot. A "valasztott" eszkozok szabalya szerint eszkozt csak
   * helyszinnel egyutt lehet megadni -- de ott a VALASZTHATO HALMAZ all a
   * helyszinbol. Itt nincs halmaz: a szerelo MEGNEVEZI azt az egyet, ami elott
   * all. Ha elutasitanank, epp arrol a gepről nem tudna jegyet nyitni, aminek
   * meg nincs rogzitve a helye.
   */
  it("helyszín NÉLKÜLI eszközről is nyílik jegy, és az eszköz FELKERÜL", async () => {
    const { service, created } = serviceWith({
      placement: { customerId: "customer-1", departmentId: null },
    });

    await service.create(torzs({ originAssetId: "asset-3" }), BELSOS.id);

    const sor = created[0] as {
      departmentId: string | null;
      assetIds: string[];
    };
    assert.equal(sor.departmentId, null);
    // A LENYEG A MASODIK SOR: a jegy NEM csendben felejti el az eszkozt.
    assert.deepEqual(sor.assetIds, ["asset-3"]);
  });

  /**
   * A MEGADOTT ERTEK ELSOBBSEGET ELVEZ: ez a mezo POTOL, nem felulir. Enelkul
   * egy webes hivas, ami veletlenul eredetet is kuld, csendben athelyezne a
   * jegyet egy masik partnerhez.
   */
  it("a kifejezetten megadott partner és helyszín NEM íródik felül", async () => {
    const { service, created } = serviceWith({
      placement: { customerId: "eredet-customer", departmentId: "eredet-dep" },
    });

    await service.create(
      torzs({
        originAssetId: "asset-4",
        customerId: "megadott-customer",
        departmentId: "megadott-dep",
      }),
      BELSOS.id,
    );

    const sor = created[0] as { customerId: string; departmentId: string };
    assert.equal(sor.customerId, "megadott-customer");
    assert.equal(sor.departmentId, "megadott-dep");
  });

  /**
   * AZ ISMERETLEN ESZKOZ MEGNEVEZETT HIBA, NEM CSENDES ELHAGYAS.
   *
   * Ha a levezetes nemán kimaradna, a jegy partner nelkul szuletne -- es a
   * szerelo azt hinne, hogy az eszkozrol nyitotta.
   */
  it("ismeretlen eredet-eszköznél ELBUKIK, megnevezve", async () => {
    const { service, created } = serviceWith({ placement: null });

    await assert.rejects(
      () => service.create(torzs({ originAssetId: "nincs-ilyen" }), BELSOS.id),
      /nem található/,
    );
    assert.deepEqual(created, [], "a jegy nem jöhetett létre");
  });

  /**
   * TESTVER-KONTROLL: EREDET NELKUL A REGI UT VALTOZATLAN.
   *
   * Enelkul a fenti allitasok akkor is zoldek lennenek, ha a levezetes MINDIG
   * lefutna -- es a webes hivasokat is atirna.
   */
  it("eredet nélkül semmi nem változik", async () => {
    const { service, created } = serviceWith({ placement: null });

    await service.create(
      torzs({ customerId: "customer-9", departmentId: "dep-9" }),
      BELSOS.id,
    );

    const sor = created[0] as { customerId: string; assetIds: string[] };
    assert.equal(sor.customerId, "customer-9");
    assert.deepEqual(sor.assetIds, []);
  });
});
