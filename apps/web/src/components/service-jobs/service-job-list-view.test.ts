import type {
  ServiceJobListItem,
  ServiceJobStatusCounts,
} from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  itemsForTab,
  listFooterLine,
  listSummary,
  SERVICE_JOB_TABS,
  tabDefinition,
} from "./service-job-list-view";

function counts(
  overrides: Partial<ServiceJobStatusCounts> = {},
): ServiceJobStatusCounts {
  return {
    NEW: 0,
    TRIAGED: 0,
    SCHEDULED: 0,
    IN_PROGRESS: 0,
    WAITING_FOR_PARTS: 0,
    WAITING_FOR_CUSTOMER: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    ...overrides,
  };
}

function item(
  id: string,
  status: ServiceJobListItem["status"],
): ServiceJobListItem {
  return {
    id,
    jobNumber: `HJ-2026-${id}`,
    title: `Jegy ${id}`,
    status,
    partnerStatus: "IN_PROGRESS",
    partnerStatusLabel: "Feldolgozás alatt",
    customerName: null,
    worksheetCount: 0,
    createdAt: "2026-09-01T08:00:00.000Z",
  };
}

describe("a lista fülei", () => {
  /**
   * A LÉNYEG: KÉT FÜL A SZERVERTŐL KÉR, KETTŐ A BETÖLTÖTTBŐL VÁLOGAT.
   *
   * Ha a `Lezárt` fül `open` hatókörrel menne, a lista mindig üres lenne - a
   * szerver ott épp a lezártakat hagyja ki. Ez az állítás nevesíti a párosítást,
   * hogy egy elgépelt hatókör ne csendes üres listaként jelenjen meg.
   */
  it("a lezárt fül a teljes halmazt kéri, a várakozó a nyitottat", () => {
    expect(tabDefinition("closed").scope).toBe("all");
    expect(tabDefinition("waiting").scope).toBe("open");
    expect(tabDefinition("open").scope).toBe("open");
    expect(tabDefinition("all").scope).toBe("all");
  });

  it("a szűretlen füleknél nincs kliensoldali válogatás", () => {
    expect(tabDefinition("all").statuses).toBeNull();
    expect(tabDefinition("open").statuses).toBeNull();
  });

  it("a várakozó fül a két váró állapotot hozza, a többit nem", () => {
    const items = [
      item("1", "WAITING_FOR_PARTS"),
      item("2", "IN_PROGRESS"),
      item("3", "WAITING_FOR_CUSTOMER"),
    ];
    expect(itemsForTab(items, "waiting").map((x) => x.id)).toEqual(["1", "3"]);
  });

  /**
   * ISMERT POZITÍV KONTROLL A MÁSIK IRÁNYRA: a szűretlen fül MINDENT átenged.
   * Enélkül a fenti állítás akkor is zöld lenne, ha a szűrés mindent kidobna.
   */
  it("az összes fül semmit nem dob el", () => {
    const items = [item("1", "WAITING_FOR_PARTS"), item("2", "COMPLETED")];
    expect(itemsForTab(items, "all")).toHaveLength(2);
  });

  it("ismeretlen fülre megáll, nem csendben üres listát ad", () => {
    expect(() => tabDefinition("nincs-ilyen" as never)).toThrow();
  });

  it("mind a négy fül szerepel, egyszer", () => {
    expect(SERVICE_JOB_TABS.map((entry) => entry.id)).toEqual([
      "all",
      "open",
      "waiting",
      "closed",
    ]);
  });
});

describe("a három szám a lista fölött", () => {
  it("a nyitott a két végállapoton kívüli minden", () => {
    const summary = listSummary(
      counts({ NEW: 3, IN_PROGRESS: 2, COMPLETED: 5, CANCELLED: 1 }),
    );
    expect(summary.open).toBe(5);
    expect(summary.closed).toBe(6);
  });

  it("a várakozó a két váró állapot összege", () => {
    const summary = listSummary(
      counts({ WAITING_FOR_PARTS: 2, WAITING_FOR_CUSTOMER: 4, NEW: 7 }),
    );
    expect(summary.waiting).toBe(6);
  });

  /**
   * A VÁRAKOZÓ A NYITOTT RÉSZE, NEM MELLETTE ÁLL. Egy olyan számolás, ami a
   * várakozókat kivonná a nyitottakból, ugyanígy nézne ki egy egyszerű
   * mintán - ez az eset megkülönbözteti a kettőt.
   */
  it("a várakozók benne vannak a nyitottakban", () => {
    const summary = listSummary(counts({ WAITING_FOR_PARTS: 2, NEW: 1 }));
    expect(summary.open).toBe(3);
    expect(summary.waiting).toBe(2);
  });
});

describe("a lista alján álló mondat", () => {
  it("teljes listánál kimondja, hogy vége", () => {
    expect(
      listFooterLine({ shown: 8, truncated: false, filtered: false }),
    ).toBe("8 találat · a lista végére értél");
  });

  /**
   * A VÁGOTT LISTA NEM HALLGATHAT. Enélkül a "200 találat" pontosan úgy nézne
   * ki, mint egy teljes lista - és a kezelő azt hinné, ennyi van.
   */
  it("vágott listánál megmondja, hogy van több", () => {
    const line = listFooterLine({
      shown: 200,
      truncated: true,
      filtered: false,
    });
    expect(line).toContain("van több");
  });

  /**
   * ÉS SZŰRT FÜLÖN MÁS A MONDAT, mert ott a szám a betöltött lapon belüli
   * válogatás eredménye. Ha ugyanaz a mondat állna ott, a hét találat azt
   * jelentené, hogy összesen hét ilyen van.
   */
  it("vágott és szűrt listánál a teljes számért a dobozokhoz küld", () => {
    const line = listFooterLine({ shown: 7, truncated: true, filtered: true });
    expect(line).toContain("betöltött");
    expect(line).toContain("dobozok");
  });

  /**
   * A HATÁR SZÁMA NEM KERÜL A SZÖVEGBE. A kétszáz a szerver lekérdezésében áll;
   * ha itt is állna, a két hely egyszer elcsúszna, és a felület magabiztosan
   * mondana rossz számot. A bemenet szándékosan HÉT, hogy a talált "200" csak
   * beégetett érték lehessen.
   */
  it("a határ számát sehol nem írja ki", () => {
    for (const filtered of [true, false])
      expect(
        listFooterLine({ shown: 7, truncated: true, filtered }),
      ).not.toContain("200");
  });
});
