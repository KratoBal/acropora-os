import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ServiceJobListItem } from "./types";

import {
  cachedItemsForScope,
  DEFAULT_SERVICE_JOB_SCOPE,
  itemsForScope,
  OFFLINE_COPY_SCOPE,
  SERVICE_JOB_SCOPES,
  serverScopeOf,
} from "./list-scope";

function felelos(userId: string) {
  return { userId, name: userId, assignedAt: "2026-10-04T08:00:00.000Z" };
}

function item(
  jobNumber: string,
  status: ServiceJobListItem["status"],
): ServiceJobListItem {
  return {
    id: jobNumber,
    jobNumber,
    title: "Nem indul a szivattyú",
    kind: "REPAIR",
    status,
    partnerStatusLabel: "Folyamatban",
    customerName: null,
    departmentPath: null,
    worksheetCount: 0,
    createdAt: "2026-09-17T06:00:00.000Z",
  };
}

const MINTA = [
  item("HJ-1", "NEW"),
  item("HJ-2", "COMPLETED"),
  item("HJ-3", "CANCELLED"),
  item("HJ-4", "WAITING_FOR_PARTS"),
];

describe("a hibajegy-lista szűrői a telefonon", () => {
  /**
   * AZ ALAPÉRTELMEZÉS A NYITOTT (Balázs, 2026-10-04 13:51 UTC, acrobot 26167).
   * Ez felülírja a 2026-09-17-es „az összes legyen az alapértelmezett” kérést;
   * az Összes fül megmarad, és a választott fül a munkamenet idejére is.
   *
   * MI PIROSÍT: ha az alapértelmezés visszacsúszna az Összesre (a lezárt
   * jegyek ismét az első képernyőn állnának), vagy ha a mentett másolatot
   * író hatókör az alapértelmezéssel együtt szűkülne: akkor a térerő nélküli
   * Összes fül csak a nyitottakat mutatná.
   */
  it("az alapértelmezés a nyitott, a másolatot az összes írja, és mind az öt szűrő szerepel", () => {
    assert.equal(DEFAULT_SERVICE_JOB_SCOPE, "open");
    assert.equal(OFFLINE_COPY_SCOPE, "all");
    assert.deepEqual(
      SERVICE_JOB_SCOPES.map((option) => option.id),
      ["open", "waiting", "closed", "all", "mine"],
    );
    assert.deepEqual(
      SERVICE_JOB_SCOPES.map((option) => option.label),
      ["Nyitott", "Várakozik", "Lezárt", "Összes", "Rám kiosztva"],
    );
  });

  it("a várakozik a nyitott választ szűkíti, a többi szűrő a szerverre megy", () => {
    assert.equal(serverScopeOf("waiting"), "open");
    for (const scope of ["all", "open", "closed", "mine"] as const)
      assert.equal(serverScopeOf(scope), scope);
    assert.deepEqual(
      itemsForScope(MINTA, "waiting").map((row) => row.jobNumber),
      ["HJ-4"],
    );
    assert.equal(itemsForScope(MINTA, "open").length, MINTA.length);
    const mentett = cachedItemsForScope(MINTA, "waiting");
    assert.ok(mentett.kind === "items");
    assert.deepEqual(
      mentett.items.map((row) => row.jobNumber),
      ["HJ-4"],
    );
  });

  /**
   * "RÁM KIOSZTVA" FROM THE SAVED COPY WHEN EVERY ROW CARRIES ITS ASSIGNEES
   * (decision 5): filtered by the user; one old row without the field turns
   * it back into "needs a connection", never a guess.
   */
  it("a rám kiosztva a mentett másolatból is szűr, ha minden soron ott a felelős", () => {
    const friss = [
      { ...item("HJ-1", "NEW"), assignees: [felelos("u-1")] },
      { ...item("HJ-2", "NEW"), assignees: [] },
      { ...item("HJ-3", "NEW"), assignees: [felelos("u-2")] },
    ];
    const enyem = cachedItemsForScope(friss, "mine", "u-1");
    assert.ok(enyem.kind === "items");
    assert.deepEqual(
      enyem.items.map((row) => row.jobNumber),
      ["HJ-1"],
    );
    assert.deepEqual(
      cachedItemsForScope([...friss, item("HJ-9", "NEW")], "mine", "u-1"),
      { kind: "needs-connection" },
    );
    assert.deepEqual(cachedItemsForScope(friss, "mine"), {
      kind: "needs-connection",
    });
  });

  /**
   * A MENTETT MÁSOLATON A NYITOTT ÉS A LEZÁRT EGYMÁS TÜKRE, ÉS EGYÜTT AZ EGÉSZ.
   *
   * A harmadik állítás nem díszítés: két külön szűrő, ami ugyanazt a sort vagy
   * kihagyná, vagy kétszer hozná, pontosan ettől bukik el -- a két darabszám
   * külön-külön hihető maradna.
   */
  it("a mentett másolaton a nyitott és a lezárt kiadja az egészet", () => {
    const osszes = cachedItemsForScope(MINTA, "all");
    const nyitott = cachedItemsForScope(MINTA, "open");
    const lezart = cachedItemsForScope(MINTA, "closed");

    assert.ok(osszes.kind === "items");
    assert.ok(nyitott.kind === "items");
    assert.ok(lezart.kind === "items");

    assert.deepEqual(
      nyitott.items.map((row) => row.jobNumber),
      ["HJ-1", "HJ-4"],
    );
    assert.deepEqual(
      lezart.items.map((row) => row.jobNumber),
      ["HJ-2", "HJ-3"],
    );
    assert.equal(
      nyitott.items.length + lezart.items.length,
      osszes.items.length,
    );
  });

  /**
   * A `RÁM KIOSZTVA` KAPCSOLAT NÉLKÜL KIMONDJA, HOGY NEM TUDJA.
   *
   * A mentett soron nincs kiosztás, tehát a szűrés nem számolható ki. A rossz
   * válasz itt nem az üres lista lenne, hanem a TELJES: az tágabb, mint a
   * felirata, és a szerelő azt hinné, minden jegy rá van osztva.
   */
  it("a rám kiosztva mentett másolatból nem számolható ki", () => {
    assert.deepEqual(cachedItemsForScope(MINTA, "mine"), {
      kind: "needs-connection",
    });
  });

  /**
   * POZITÍV KONTROLL A SZŰRÉSRE: üres bemeneten minden szűrő üreset ad, tehát a
   * fenti darabszámok a MINTÁRÓL szólnak, nem egy véletlenül beégetett listáról.
   */
  it("üres másolaton egyik szűrő sem talál ki sorokat", () => {
    for (const option of SERVICE_JOB_SCOPES) {
      const eredmeny = cachedItemsForScope([], option.id);
      if (eredmeny.kind === "items")
        assert.deepEqual(eredmeny.items, [], `nem üres: ${option.id}`);
    }
  });

  /**
   * A SZŰRÉS A SZERVERRE MEGY, NEM A BETÖLTÖTT LAPON TÖRTÉNIK.
   *
   * MIÉRT FORRÁS-SZÖVEG: a mobil tesztsorban nincs képernyő-renderelő, minden
   * állítás tiszta függvényen áll. Egy React képernyő bekötése így csak a
   * forrás alakjából mérhető. Ugyanaz a minta, amit a
   * `lib/offline/list-source-wiring.spec.ts` használ -- és ha egyszer lesz
   * renderelő, ezt az állítást VISELKEDÉSRE kell cserélni, nem mellé tenni.
   *
   * MIÉRT SZÁMÍT: a lista a szerveren vágódik kétszáz sornál. Egy kliens-oldali
   * szűrő azt ígérné, hogy az egész halmazban válogat, holott csak a
   * visszaadott lapon -- és a hiány NÉMA.
   */
  it("a képernyő a kiválasztott szűrőt a szervertől kéri", () => {
    const forras = readFileSync("src/app/service-jobs/index.tsx", "utf8");
    // POZITIV KONTROLL A BEOLVASASRA: rossz útvonalnál az alábbi keresés
    // nulla találata a fájl hiányáról szólna, nem a képernyőről.
    assert.ok(forras.length > 1000, "üres vagy gyanúsan rövid képernyő-forrás");

    const hivasok = [...forras.matchAll(/listServiceJobs\(([^)]*)\)/g)].map(
      (talalat) => talalat[1]!.trim(),
    );
    /*
      KÉT HÍVÁS 2026-10-04 ÓTA, és a második nem kliens-oldali szűrő: a
      nyitott alapértelmezés mellett a mentett másolat a TELJES listából
      íródik (`OFFLINE_COPY_SCOPE`), külön lekérdezéssel. A szűrt lista
      továbbra is a kiválasztott hatókört kéri a szervertől.
    */
    assert.deepEqual(
      [...hivasok].sort(),
      ['OFFLINE_COPY_SCOPE, "ALL"', 'serverScope, "ALL"'],
      `A képernyő ${hivasok.length} helyen hívja a listát, ezekkel: ${hivasok.join(", ")}. Két hívást várok: a kiválasztott szűrővel és a másolat teljes listájával.`,
    );
  });
});
