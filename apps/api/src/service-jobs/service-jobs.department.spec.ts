import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A HELYSZIN A JEGYEN: HOVA KERUL, ES MIT UTASIT EL A SZERVER.
 *
 * Balazs kerese (2026-09-14): a hibajegy felvitelen a partner utan rogton a
 * helyszin jojjon. Ez a fajl azt orzi, hogy a helyszin NE CSUSZHASSON MAS
 * PARTNER ALA.
 *
 * AMIERT A SZERVEREN DOL EL, ES NEM A FELULETEN: a valaszto ma csak a
 * kivalasztott partner egysegeit kinalja, de a vegpontra barmit be lehet irni.
 * Egy idegen egyseghez kotott jegy a kepernyon URESNEK latszana, nem hibasnak --
 * a lista a sajat partner egysegeit rajzolja, es az idegen azonosito
 * egyszeruen nem lenne kozottuk.
 */

type CreateArg = Parameters<ServiceJobsRepository["create"]>[0];

function serviceWith(options: {
  belongs: boolean;
  /** Amit a taroló "nincs ezen a helyszinen" valaszkent ad vissza. */
  kivul?: string[];
  onCreate?: (input: CreateArg) => void;
}) {
  const repository: Pick<
    ServiceJobsRepository,
    | "create"
    | "lastNumberOfYear"
    | "departmentBelongsToCustomer"
    | "assetsOutsideDepartment"
  > = {
    lastNumberOfYear: async () => null,
    departmentBelongsToCustomer: async () => options.belongs,
    assetsOutsideDepartment: async () => options.kivul ?? [],
    create: async (input) => {
      options.onCreate?.(input);
      return { id: "job-1", jobNumber: input.jobNumber };
    },
  };
  return new ServiceJobsService(repository as ServiceJobsRepository);
}

const MOST = new Date("2026-09-14T18:00:00.000Z");

describe("a hibajegy helyszine a felvitelen", () => {
  it("a partnere helyszinet atadja a tarolonak", async () => {
    let kapott: CreateArg | null = null;
    const service = serviceWith({
      belongs: true,
      onCreate: (input) => {
        kapott = input;
      },
    });

    await service.create(
      {
        title: "Szivattyú leállt",
        customerId: "cust-1",
        departmentId: "unit-9",
      },
      "user-1",
      MOST,
    );

    assert.equal(kapott!.departmentId, "unit-9");
    assert.equal(kapott!.customerId, "cust-1");
  });

  /**
   * A KALIBRACIO MASIK IRANYA. Az elozo allitas onmagaban akkor is zold lenne,
   * ha a szerver MINDEN helyszint atengedne: azt meri, hogy a jo eset atmegy.
   * Ez meri, hogy a rossz eset elakad.
   */
  it("mas partner helyszinet elutasitja", async () => {
    let hivtak = false;
    const service = serviceWith({
      belongs: false,
      onCreate: () => {
        hivtak = true;
      },
    });

    await assert.rejects(
      () =>
        service.create(
          {
            title: "Szivattyú leállt",
            customerId: "cust-1",
            departmentId: "masik-partner-egysege",
          },
          "user-1",
          MOST,
        ),
      /nem ehhez a partnerhez tartozik/,
    );
    assert.equal(
      hivtak,
      false,
      "Az elutasitott jegy nem keletkezhet meg fel-kesz allapotban.",
    );
  });

  /**
   * PARTNER NELKULI HELYSZIN: KULON AG, KULON UZENET.
   *
   * Nem "ismeretlen egyseg", hanem ertelmetlen keres -- helyszine csak
   * partnernek van. A ket hiba mas javitast ker a hivotol, tehat nem szabad
   * egy uzenet ala vonni oket.
   */
  it("partner nelkul megadott helyszint elutasit, sajat uzenettel", async () => {
    const service = serviceWith({ belongs: true });

    await assert.rejects(
      () =>
        service.create(
          { title: "Szivattyú leállt", departmentId: "unit-9" },
          "user-1",
          MOST,
        ),
      /csak partnerrel együtt/,
    );
  });

  /**
   * A HELYSZIN NELKULI FELVITEL VALTOZATLANUL MEGY. Ez a mai jegyek osszes
   * esete, es a mezo elhagyhato marad: a jegy partner nelkul is megnyilik.
   */
  it("helyszin nelkul a jegy ugyanugy megnyilik", async () => {
    let kapott: CreateArg | null = null;
    const service = serviceWith({
      belongs: false,
      onCreate: (input) => {
        kapott = input;
      },
    });

    await service.create({ title: "Szivattyú leállt" }, "user-1", MOST);

    assert.equal(kapott!.departmentId, null);
    assert.equal(kapott!.customerId, null);
  });

  /**
   * AZ URES SZOVEG NEM HELYSZIN. Egy urlap, ami a "nincs kivalasztva" allapotot
   * ures szovegkent kuldi, ne fusson bele az ellenorzesbe -- es fokent ne
   * keletkezzen tole olyan jegy, aminek a helyszine ures sztring.
   */
  it("az ures helyszin-azonosito nem valt ki ellenorzest", async () => {
    let kapott: CreateArg | null = null;
    const service = serviceWith({
      belongs: false,
      onCreate: (input) => {
        kapott = input;
      },
    });

    await service.create(
      { title: "Szivattyú leállt", customerId: "cust-1", departmentId: "  " },
      "user-1",
      MOST,
    );

    assert.equal(kapott!.departmentId, null);
  });
});

/**
 * AZ ESZKOZOK A JEGYEN: MI MEGY AT, ES MI AKAD EL.
 *
 * Balazs kerese (2026-09-14): "a partner helyszinehez kapcsolod eszkozok kozul
 * lehessen kivalasztani, akar tobbet is."
 */
describe("a hibajegy eszkozei a felvitelen", () => {
  it("a valasztott eszkozoket atadja a tarolonak", async () => {
    let kapott: CreateArg | null = null;
    const service = serviceWith({
      belongs: true,
      onCreate: (input) => {
        kapott = input;
      },
    });

    await service.create(
      {
        title: "Szivattyú leállt",
        customerId: "cust-1",
        departmentId: "unit-9",
        assetIds: ["esz-1", "esz-2"],
      },
      "user-1",
      MOST,
    );

    assert.deepEqual([...kapott!.assetIds], ["esz-1", "esz-2"]);
  });

  /**
   * A KALIBRACIO MASIK IRANYA: a fenti allitas akkor is zold lenne, ha a
   * szerver MINDEN eszkozt atengedne.
   */
  it("a helyszinen kivuli eszkozt elutasitja, es megmondja hanyat", async () => {
    let hivtak = false;
    const service = serviceWith({
      belongs: true,
      kivul: ["esz-idegen", "esz-masik"],
      onCreate: () => {
        hivtak = true;
      },
    });

    await assert.rejects(
      () =>
        service.create(
          {
            title: "Szivattyú leállt",
            customerId: "cust-1",
            departmentId: "unit-9",
            assetIds: ["esz-1", "esz-idegen", "esz-masik"],
          },
          "user-1",
          MOST,
        ),
      /Ez a 2 eszköz nem a megadott helyszínen áll/,
    );
    assert.equal(hivtak, false);
  });

  /**
   * HELYSZIN NELKULI ESZKOZ-LISTA: SAJAT AG, SAJAT UZENET. Nem "ismeretlen
   * eszkoz", hanem hianyzo helyszin -- mas a teendo.
   */
  it("helyszin nelkul megadott eszkozt elutasit, sajat uzenettel", async () => {
    const service = serviceWith({ belongs: true });

    await assert.rejects(
      () =>
        service.create(
          {
            title: "Szivattyú leállt",
            customerId: "cust-1",
            assetIds: ["esz-1"],
          },
          "user-1",
          MOST,
        ),
      /csak helyszínnel együtt/,
    );
  });

  /**
   * A KETSZER MEGADOTT ESZKOZ EGYSZER KERUL FEL. A kapcsolotablan `@@unique`
   * all, tehat a duplikatum amugy is elhasalna -- de egy adatbazis-hiba a
   * felhasznalonak semmit nem mond arrol, mi tortent.
   */
  it("a duplan megadott eszkozt egyszer adja tovabb", async () => {
    let kapott: CreateArg | null = null;
    const service = serviceWith({
      belongs: true,
      onCreate: (input) => {
        kapott = input;
      },
    });

    await service.create(
      {
        title: "Szivattyú leállt",
        customerId: "cust-1",
        departmentId: "unit-9",
        assetIds: ["esz-1", "esz-1", "esz-2"],
      },
      "user-1",
      MOST,
    );

    assert.deepEqual([...kapott!.assetIds], ["esz-1", "esz-2"]);
  });

  /**
   * ESZKOZ NELKUL A FELVITEL VALTOZATLAN, es a taroló URES tombot kap, nem
   * `undefined`-et: a hivo ne kelljen, hogy megkulonboztesse a ketto kozott.
   */
  it("eszkoz nelkul ures listat ad a tarolonak", async () => {
    let kapott: CreateArg | null = null;
    const service = serviceWith({
      belongs: true,
      onCreate: (input) => {
        kapott = input;
      },
    });

    await service.create({ title: "Szivattyú leállt" }, "user-1", MOST);

    assert.deepEqual([...kapott!.assetIds], []);
  });
});
