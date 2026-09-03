import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * BELSOS HIVO: a reszletlap tartalmarol szolo allitasok NEM a hatokorrol
 * szolnak, tehat itt a szures ures objektum. A hatokort a
 * `service-job-visibility.spec.ts` meri, kulon.
 */
const BELSOS = { id: "user-1", customerId: null, supplierId: null } as never;

type DetailRow = Awaited<ReturnType<ServiceJobsRepository["detail"]>>;

/**
 * A VARRAT A VALÓDI SZERZŐDÉS TÍPUSÁT KAPJA (`Pick<...>`), nem `unknown`-t: a
 * részletlap alakja a felület szerződése, és ha a tároló visszatérése
 * elmozdul a duplától, a fordító szóljon, ne a képernyő.
 */
function serviceWith(row: DetailRow) {
  const repository: Pick<ServiceJobsRepository, "detail"> = {
    detail: async () => row,
  };
  return new ServiceJobsService(repository as ServiceJobsRepository);
}

function row(overrides: Partial<NonNullable<DetailRow>> = {}) {
  return {
    id: "job-1",
    jobNumber: "HJ-2026-001",
    title: "Szivattyú leállt",
    description: null,
    status: "TRIAGED" as const,
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    scheduledAt: null,
    startedAt: null,
    completedAt: new Date("2026-09-04T08:00:00.000Z"),
    customer: { displayName: "Fővárosi Állat- És Növénykert" },
    events: [
      {
        id: "event-1",
        fromStatus: null,
        toStatus: "NEW" as const,
        note: null,
        createdAt: new Date("2026-09-01T08:00:00.000Z"),
        actor: { displayName: "Szerelő Sándor" },
      },
    ],
    worksheets: [
      {
        id: "worksheet-1",
        number: null,
        createdAt: new Date("2026-09-02T08:00:00.000Z"),
        handedOverAt: null,
      },
    ],
    assets: [
      {
        id: "link-1",
        assetId: "asset-1",
        createdAt: new Date("2026-09-02T09:00:00.000Z"),
        asset: { assetNumber: "ESZ-0007", name: "Szivattyú" },
      },
    ],
    ...overrides,
  } satisfies NonNullable<DetailRow>;
}

describe("a hibajegy részletlapja", () => {
  it("dátumot ISO szöveggé fordít, mert a válasz JSON, nem Date", async () => {
    const detail = await serviceWith(row()).detail("job-1", BELSOS);

    assert.equal(detail.createdAt, "2026-09-01T08:00:00.000Z");
    assert.equal(detail.completedAt, "2026-09-04T08:00:00.000Z");
    // A SORRENDTŐL FÜGGETLENÜL keressük ki: ez az állítás a dátum-fordítást
    // méri, nem a rendezést. Index szerint hivatkozva egy rendezési hiba is
    // ezt pirosítaná, és akkor két állítás mondaná ugyanazt.
    const naplosor = detail.timeline.find((entry) => entry.kind === "status");
    assert.equal(naplosor?.at, "2026-09-01T08:00:00.000Z");
  });

  /**
   * AZ ÖSSZEFÉSÜLÉS A SZERVERÉ, NEM A KLIENSÉ.
   *
   * A minta úgy áll, hogy a két csatolás a naplósor UTÁN keletkezett: ha a
   * végpont három listát adna vissza, vagy fésülés nélkül fűzné össze őket, ez
   * az állítás pirosodna. A kliens rajzol, nem dönt.
   */
  it("egy időrendbe fésülve adja vissza a három forrást, legújabb felül", async () => {
    const detail = await serviceWith(row()).detail("job-1", BELSOS);

    assert.deepEqual(
      detail.timeline.map((entry) => entry.kind),
      ["asset", "worksheet", "status"],
    );
  });

  /**
   * A `scheduledAt` NEM SZÁRMAZTATOTT, a másik kettő az - de mindhárom
   * MEGJELENIK a válaszban. Ha kimaradnának, a felület a naplóból kezdené
   * visszafejteni őket, és a szabály két helyen állna.
   */
  it("mindhárom időbélyeget kiadja, a tervezettet is", async () => {
    const detail = await serviceWith(row()).detail("job-1", BELSOS);

    assert.equal(detail.scheduledAt, null);
    assert.equal(detail.startedAt, null);
    assert.equal(detail.completedAt, "2026-09-04T08:00:00.000Z");
  });

  /**
   * A LÉPÉSEKET A TÁBLA ADJA, NEM A FELÜLET. Ha a válasz nem vinné, a kliens
   * kezdené el kitalálni, mi mehet - és onnantól az átmenet-szabály két helyen
   * állna, ami közül csak az egyik a szerver.
   */
  it("megmondja, mit tehet a jegy innen", async () => {
    const detail = await serviceWith(row()).detail("job-1", BELSOS);
    assert.ok(detail.allowedSteps.length > 0);
    assert.ok(!detail.allowedSteps.includes("NEW"));
    /**
     * A KOVETELMENY-LISTA AZ ENGEDETT LEPESEK RESZHALMAZA, ES NEM UGYANAZ.
     *
     * A HARMADIK ALLITAS `SCHEDULED`-re SZOL, ES EZ NEM MINDEGY. Eloszor
     * `TRIAGED`-et irtam ide, es a kalibracio megmutatta, hogy az allitas MAS
     * OKBOL lett volna zold: `TRIAGED`-bol nem lehet `TRIAGED`-be lepni, tehat
     * az az ertek amugy sem allhatna a listaban. A `SCHEDULED` viszont
     * ENGEDETT lepes innen, csak nem kovetel indokot -- vagyis csak az az
     * allitas meri a SZURESt, aminel a tobbi feltetel igaz.
     */
    for (const step of detail.stepsRequiringNote) {
      assert.ok(detail.allowedSteps.includes(step), step);
    }
    assert.ok(detail.allowedSteps.includes("SCHEDULED"));
    assert.ok(detail.stepsRequiringNote.includes("CANCELLED"));
    assert.ok(!detail.stepsRequiringNote.includes("SCHEDULED"));
  });

  it("lezárt jegyen üres a lépések listája", async () => {
    const detail = await serviceWith(row({ status: "CANCELLED" })).detail(
      "job-1",
      BELSOS,
    );
    assert.deepEqual(detail.allowedSteps, []);
  });

  /**
   * A TÖRÖLT FELHASZNÁLÓ NEM VISZI MAGÁVAL A NAPLÓT: az `actor` `null` lehet,
   * és a válasznak akkor is teljesnek kell lennie. Egy hiányzó mező itt a
   * kliensen `undefined`-ként jelenne meg, hibaüzenet nélkül.
   */
  it("aktor nélküli naplósort is kiad, nem hagyja ki", async () => {
    const eventek = row().events.map((event) => ({ ...event, actor: null }));
    const detail = await serviceWith(row({ events: eventek })).detail(
      "job-1",
      BELSOS,
    );

    const naplosorok = detail.timeline.filter(
      (entry) => entry.kind === "status",
    );
    assert.equal(naplosorok.length, 1);
    assert.equal(
      naplosorok[0]!.kind === "status" ? naplosorok[0]!.event.actorName : "x",
      null,
    );
  });

  it("nem létező jegyre nem találhatót mond, nem üres részletlapot", async () => {
    await assert.rejects(
      () => serviceWith(null).detail("hianyzik", BELSOS),
      /nem található/,
    );
  });
});
