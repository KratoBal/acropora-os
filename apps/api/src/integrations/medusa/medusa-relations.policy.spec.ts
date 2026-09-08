import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideMedusaSimilarIds,
  describeMissingSimilarMapping,
  MEDUSA_SIMILAR_IDS_KEY,
  similarIdsMetadataValue,
  type ProductRelationRow,
} from "./medusa-relations.policy.js";

/**
 * MINDEN ALLITAS KULON TESZTBEN ALL.
 *
 * Nem stilus: egy kalibracios rontas kimenete a TESZT nevet irja ki, nem az
 * allitasét. Ket kulon ronthato allitas egy tesztben tehat
 * megkulonboztethetetlen -- a kimenetbol nem derulne ki, melyik fogott.
 */
const par = (
  targetProductId: string,
  sortOrder: number | null,
): ProductRelationRow => ({ targetProductId, sortOrder });

const lekepezes = (...parok: [string, string][]) => new Map(parok);

describe("a hasonló kapcsolatok leképezése a vetítésben", () => {
  /**
   * A BEMENET UGY VAN VALASZTVA, HOGY A KET RENDEZESI SZABALY ELTERJEN.
   *
   * Az elso valtozatban `os-a`=1, `os-b`=2, `os-c`=3 allt -- ott a `sortOrder`
   * es a cel-azonosito UGYANAZT a sorrendet adja, tehat a kalibracios rontas
   * (a `sortOrder` osszevetesenek semlegesitese) ZOLDEN atment: a masodlagos
   * rendezes ugyanazt a kimenetet adta. Az allitas neve a `sortOrder`-t igerte,
   * a bemenete viszont nem tudta megkulonboztetni a kettot.
   *
   * Igy a ket szabaly ELLENTETES sorrendet ad, tehat csak az egyik lehet igaz.
   */
  it("a sortOrder szerint rendez, nem a cél-azonosító szerint", () => {
    const dontes = decideMedusaSimilarIds(
      [par("os-a", 3), par("os-b", 1), par("os-c", 2)],
      lekepezes(["os-a", "m-a"], ["os-b", "m-b"], ["os-c", "m-c"]),
    );

    assert.deepEqual(dontes.medusaSimilarIds, ["m-b", "m-c", "m-a"]);
  });

  /**
   * A `sortOrder` NULLAZHATO (`Int?`), es hogy a `NULL` hova kerul, az
   * adatbazis-fuggo. Ezert all a rendezes tiszta fuggvenyben, es ezert van
   * ra kulon allitas: a gondozott sorrend elorebb valo, mint a gondozatlan.
   */
  it("a sortOrder nélküli kapcsolat a rendezettek MÖGÉ kerül", () => {
    const dontes = decideMedusaSimilarIds(
      [par("os-nulla", null), par("os-elso", 1)],
      lekepezes(["os-nulla", "m-nulla"], ["os-elso", "m-elso"]),
    );

    assert.deepEqual(dontes.medusaSimilarIds, ["m-elso", "m-nulla"]);
  });

  /**
   * MASODLAGOS RENDEZES. Enelkul ket azonos `sortOrder` sorrendje a lekerdezes
   * visszateresi sorrendjen mulna, ami nem garantalt -- es a kimeno sztring
   * futasrol futasra valtozna. A vetites akkor minden futasban valtozast latna
   * ott, ahol nincs, es sajat magat tartana vegtelen munkaban.
   */
  it("azonos sortOrder mellett a cél-azonosító dönt", () => {
    const dontes = decideMedusaSimilarIds(
      [par("os-b", 5), par("os-a", 5)],
      lekepezes(["os-a", "m-a"], ["os-b", "m-b"]),
    );

    assert.deepEqual(dontes.medusaSimilarIds, ["m-a", "m-b"]);
  });

  /**
   * A LEKEPEZETLEN CELPONT KIMARAD, ES A TOBBI KIMEGY (acrobot, msg_id 15026).
   *
   * Itt szandekosan MAS a szabaly, mint a kategorianal: ott egyetlen hianyzo
   * lekepezes az EGESZ listat visszatartja, mert a `categories` mezo
   * letorolhetne a tobbit. Ez egy `metadata` kulcs, aminek mi vagyunk a
   * gazdaja -- egy rovidebb lista nem vesz el semmit.
   */
  it("a leképezetlen célpont kimarad, a többi kimegy", () => {
    const dontes = decideMedusaSimilarIds(
      [par("os-a", 1), par("os-nincs", 2), par("os-b", 3)],
      lekepezes(["os-a", "m-a"], ["os-b", "m-b"]),
    );

    assert.deepEqual(dontes.medusaSimilarIds, ["m-a", "m-b"]);
  });

  /**
   * ES A KIHAGYAS LATSZIK IS. Kulon allitas, mert a kihagyas es a JELZESE ket
   * kulon dolog: egy dontes, ami kihagy es `complete`-et mond, ugyanazt a
   * sztringet adja -- es a hianyt csendben elnyelne.
   */
  it("a kihagyott célpontot megnevezi és hiánynak jelöli", () => {
    const dontes = decideMedusaSimilarIds(
      [par("os-a", 1), par("os-nincs", 2)],
      lekepezes(["os-a", "m-a"]),
    );

    assert.equal(dontes.kind, "incomplete");
    assert.deepEqual(dontes.missing, ["os-nincs"]);
  });

  it("teljes leképezésnél nincs hiány", () => {
    const dontes = decideMedusaSimilarIds(
      [par("os-a", 1)],
      lekepezes(["os-a", "m-a"]),
    );

    assert.equal(dontes.kind, "complete");
  });

  /**
   * A KAPCSOLAT NELKULI TERMEK NEM HIANY. A ket allapot ("nincs kapcsolata" es
   * "van, de egyik sincs lekepezve") a kimeno kulcsra nezve ugyanaz -- a
   * kulcs egyik esetben sem megy ki --, de a MASODIK hiany, es ki kell mondani.
   */
  it("kapcsolat nélküli terméknél nincs mit küldeni, és ez nem hiány", () => {
    const dontes = decideMedusaSimilarIds([], new Map());

    assert.equal(dontes.kind, "none");
    assert.deepEqual(dontes.medusaSimilarIds, []);
  });

  it("minden célpont leképezetlen: üres lista, de HIÁNY", () => {
    const dontes = decideMedusaSimilarIds([par("os-nincs", 1)], new Map());

    assert.equal(dontes.kind, "incomplete");
    assert.deepEqual(dontes.medusaSimilarIds, []);
  });

  /**
   * A HIVO TOMBJE NEM A MIENK. A `sort` a HELYEN rendez: egy hianyzo masolas
   * a hivo lekerdezesenek eredmenyet irna at. Ez a fajta mellekhatas nem
   * hibazik, csak kesobb, mashol jelenik meg.
   */
  it("nem rendezi át a hívó tömbjét", () => {
    const bemenet = [par("os-b", 2), par("os-a", 1)];

    decideMedusaSimilarIds(bemenet, lekepezes(["os-a", "m-a"]));

    assert.deepEqual(
      bemenet.map((sor) => sor.targetProductId),
      ["os-b", "os-a"],
    );
  });
});

describe("a metaadatba kerülő érték", () => {
  it("vesszővel fűzi össze az azonosítókat", () => {
    assert.equal(similarIdsMetadataValue(["m-a", "m-b"]), "m-a,m-b");
  });

  /**
   * A KULCS NEVE BEEGETVE ALL, ES EZ ITT MAGA A VEDELEM.
   *
   * A kirakat (masik repo) ugyanezt a sztringet mondja ki egy sajat
   * konstansban. Kozos csomag nincs, tehat a ket oldalt semmi nem tartja
   * ossze -- es ha elcsusznak, SEMMI NEM HIBAZIK: a doboz nem jelenik meg, es
   * a hiba nema. Egy `assert.equal(MEDUSA_SIMILAR_IDS_KEY, MEDUSA_SIMILAR_IDS_KEY)`
   * alaku allitas semmit nem erne: a beegetett literal az egyetlen, ami egy
   * atnevezes utan PIROSRA valt.
   */
  it("a kulcs neve az, amit a kirakat olvas", () => {
    assert.equal(MEDUSA_SIMILAR_IDS_KEY, "unas_similar_ids");
  });
});

describe("a hiány sora", () => {
  it("a kihagyottak számát a teljes darabszámhoz méri", () => {
    const sor = describeMissingSimilarMapping("prod-1", 14, 15);

    assert.ok(sor.includes("14/15"), `a sor nem nevezi meg az arányt: ${sor}`);
  });
});
