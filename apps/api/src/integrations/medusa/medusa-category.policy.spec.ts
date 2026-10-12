import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  decideMedusaCategories,
  decideProductCategories,
  describeMissingCategoryMapping,
  MEDUSA_CATEGORY_REFERENCE,
  MEDUSA_STORE_CATEGORY_REFERENCE,
  orderedStoreCategoryIds,
  planProductCategories,
  primaryMedusaCategoryId,
} from "./medusa-category.policy.js";

describe("a kategóriák leképezése a vetítésben", () => {
  it("teljes leképezésnél a Medusa-azonosítókat adja, a bemenet sorrendjében", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [
        { entityId: "cat_hal", externalId: "pcat_hal" },
        { entityId: "cat_korall", externalId: "pcat_korall" },
      ],
    );

    assert.equal(decision.kind, "complete");
    // A lekérdezés visszatérési sorrendje NEM garantált: a kimenet a bemenetet
    // követi, különben két futás két különböző kérés-törzset adna.
    assert.deepEqual(decision.medusaCategoryIds, ["pcat_korall", "pcat_hal"]);
    assert.deepEqual(decision.missing, []);
  });

  it("kategória nélküli terméknél nincs mit küldeni", () => {
    const decision = decideMedusaCategories([], []);

    assert.equal(decision.kind, "none");
    assert.equal(decision.medusaCategoryIds, null);
    assert.deepEqual(decision.missing, []);
  });

  /**
   * MINDEN VAGY SEMMI. Egyetlen hiányzó leképezés az EGÉSZ mezőt visszatartja:
   * a részleges lista -- ha a mező csere-szemantikájú -- letörölné a termékről
   * azokat a kategóriákat, amiket nem tudtunk megnevezni.
   */
  it("egyetlen hiányzó leképezés az egész mezőt visszatartja", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [{ entityId: "cat_korall", externalId: "pcat_korall" }],
    );

    assert.equal(decision.kind, "incomplete");
    assert.equal(decision.medusaCategoryIds, null);
    assert.deepEqual(decision.missing, ["cat_hal"]);
  });

  /**
   * EZ AZ AZ ÁLLÍTÁS, AMIÉRT A DÖNTÉS UNIÓ ÉS NEM EGY MEZŐ.
   *
   * A "nincs kategóriája" és a "van, de még nincs leképezve" a kérés törzsére
   * nézve UGYANAZ: egyik sem küld `categories` kulcsot. A következményük
   * viszont ellentétes -- az első rendben van, a második hiányt jelez --, és ha
   * a két állapot ugyanúgy nézne ki, később senki nem tudná megmondani,
   * melyik állt fenn.
   */
  it("a két üres eset a törzsre nézve azonos, a jelentésre nézve NEM", () => {
    const nincs = decideMedusaCategories([], []);
    const nincsLekepezve = decideMedusaCategories(["cat_hal"], []);

    // A törzs szempontjából megkülönböztethetetlen: ez a szándék.
    assert.equal(nincs.medusaCategoryIds, null);
    assert.equal(nincsLekepezve.medusaCategoryIds, null);

    // A jelentés szempontjából viszont NEM az.
    assert.notEqual(nincs.kind, nincsLekepezve.kind);
    assert.deepEqual(nincs.missing, []);
    assert.deepEqual(nincsLekepezve.missing, ["cat_hal"]);
  });

  /**
   * A HIÁNYT HALMAZ-LEFEDÉS DÖNTI EL, NEM A KÉT LISTA HOSSZA.
   *
   * Ez a bemenet pontosan azon a különbségen áll: két kategória, két
   * leképezés-sor -- de az egyik sor DUPLIKÁTUM, tehát az egyik kategória
   * lefedetlen. Hossz-összevetéssel ez "teljes" lenne, és részleges listát
   * küldenénk ki: pont azt a csendes törlést, amit ez a modul megelőz.
   *
   * A séma ma mindkét oldalon kizárja a duplikációt
   * (`ProductCategory @@unique([productId, categoryId])`,
   * `ExternalReference @@unique([system, entityType, entityId])`), tehát ez a
   * bemenet MA nem áll elő. Az állítás nem is a mai adatot méri, hanem azt,
   * hogy egy megszorítás elvesztése ne NÉMA hibává váljon.
   */
  it("duplikált leképezés-sor nem tesz teljessé egy hiányos lefedést", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [
        { entityId: "cat_korall", externalId: "pcat_korall" },
        { entityId: "cat_korall", externalId: "pcat_korall" },
      ],
    );

    assert.equal(decision.kind, "incomplete");
    assert.deepEqual(decision.missing, ["cat_hal"]);
  });

  it("ismétlődő bemeneti azonosító nem jelent hiányt", () => {
    const decision = decideMedusaCategories(
      ["cat_hal", "cat_hal"],
      [{ entityId: "cat_hal", externalId: "pcat_hal" }],
    );

    assert.equal(decision.kind, "complete");
    assert.deepEqual(decision.medusaCategoryIds, ["pcat_hal"]);
  });

  /**
   * A SOR AZ AZONOSÍTÓKAT NEVEZI MEG, nem csak a darabszámot: a leképezés
   * pótlása pontosan azokon múlik.
   */
  it("a hiány sora megnevezi, MELYIK kategória hiányzik", () => {
    const sor = describeMissingCategoryMapping("prod_1", [
      "cat_hal",
      "cat_rak",
    ]);

    assert.match(sor, /prod_1/);
    assert.match(sor, /2 kategória/);
    assert.match(sor, /cat_hal, cat_rak/);
    assert.match(sor, /EGYIKET SEM/);
  });

  /**
   * ES MEGMONDJA, MIT NEZZEN MEG AZ, AKI MINDEN TERMEKNEL EZT LATJA.
   *
   * Ket kulonbozo ok adja ugyanezt a kimenetet: a betoltes meg nem futott, vagy
   * lefutott ROSSZ azonositokkal (a forras-fajl az UNAS azonositoit hordozza).
   * A sor maga nem tudja eldonteni -- azt egy lekerdezes dontii el --, de
   * megnevezi, MELYIK lekerdezes.
   *
   * A fuggveny ettol tiszta marad: nem kerdez le semmit, csak megmondja, mit
   * kell megnezni.
   */
  it("names the query that tells the two causes apart", () => {
    const sor = describeMissingCategoryMapping("prod_1", ["cat_hal"]);

    assert.match(sor, /MINDEN terméknél/);
    assert.match(sor, /a betöltés nem futott/);
    assert.match(sor, /rossz\s+azonosítókkal/);
    assert.match(sor, /MEDUSA\/Category sorok száma/);
  });
});

/**
 * SZERKEZETI ALLITAS: a lekepezes-sor keresesi kulcsa EGY helyen all.
 *
 * Nem a viselkedest meri, hanem a LEFEDETTSEGET -- ugyanaz az alak, mint a
 * titok-olvasas specje. Az ok a `system` es az `entityType` KULONBSEGE: a
 * `system` a sema ENUMJA, tehat egy elgepeles forditasi hiba. Az `entityType`
 * szabad `String`, tehat NEM az.
 *
 * A tabla ket vegen ket iró all: a betoltes IR ide, a vetites innen OLVAS. Ha a
 * ket oldal ket irasmodot hasznalna, semmi nem szolna -- a vetites minden
 * termeknel "meg nincs lekepezve" allapotot latna, es kategoria nelkul
 * vetitene. A repoban mindket irasmod letezik (`"Category"` es `"CATEGORY"`),
 * csak ket kulonbozo tablanal, es ugyanabban a modulban egymas mellett.
 *
 * A lista GEPI, nem kezzel karbantartott: pontosan egy holnap szuletett uj
 * fajl ellen ved, ami sajat literalt irna.
 *
 * === ES A MINTA A HASZNALAT MINDEN ALAKJAT NEZI, NEM CSAK EGYET ===
 *
 * Az elso valtozata `entityType:\s*"Category"` volt, tehat CSAK a kettospontos
 * alakot latta. Murena merte vissza, ugyanabbol a munkakonyvtarbol, ket alakkal
 * egy medusa fajlban: a kettospontos alak EGY pirosat adott, a modul-szintu
 * `const X = "Category" as const` alak 11/11 ZOLDET. Es ez nem elmeleti volt --
 * a `medusa-category-link.repository.ts` epp abban a formaban allt, es az orzo
 * hallgatott rola.
 *
 * Ugyanaz a csapda, amit ez a repo mashol mar gyujt: a NEVEKRE (itt: egy
 * szintaktikai alakra) kereses csak azt talalja meg, amit mar ismerunk. Ezert a
 * minta most BARMELY `"Category"` string literalt nezi a kodban.
 *
 * === A KOMMENTEK KISZURESE NEM KENYELEM, HANEM A TAG MINTA ARA ===
 *
 * A `medusa-category-tree.ts` fejleceben a szerzodes le van irva, `"Category"`
 * szoval egyutt. Az MAGYARAZAT, nem hasznalat. A regi, szuk minta ezen csak
 * VELETLENUL nem akadt fenn: a komment `*` prefixe torte meg a `entityType:` es
 * a literal kozotti whitespace-t. Szerencse volt, nem terv -- ezert a
 * komment-sorok most kifejezetten kimaradnak.
 */
const CATEGORY_LITERAL = /["']Category["']/;

/**
 * A komment-sorok nelkul. HAROM alakot kell kiszurni, nem kettot: a blokk-komment
 * folytatasat (`*`), a sor-kommentet (`//`) ES a NYITO sort (`/*`) -- az utobbi az
 * egysoros JSDoc, ami `/`-rel kezdodik, tehat a `*` szuroje nem fogja.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
}
const POLICY_FILE = "src/integrations/medusa/medusa-category.policy.ts";
const PROJECTION_CLI = "src/integrations/medusa/medusa-projection.cli.ts";

async function medusaSources(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/integrations/medusa/**/*.ts"))
    if (!entry.endsWith(".spec.ts")) found.push(entry.replaceAll("\\", "/"));
  return found.sort();
}

describe("a leképezés-sor keresési kulcsa", () => {
  /**
   * A KONTROLL A KERESESRE. Enelkul egy elrontott minta nulla talalatot adna, es
   * a teszt zolden azt allitana, hogy sehol nincs sajat literal -- holott azt
   * jelentene, hogy a kereses romlott el.
   */
  it("finds BOTH shapes in a sample that has them", () => {
    // A kettospontos alak, amit a regi minta is latott.
    assert.equal(CATEGORY_LITERAL.test('entityType: "Category",'), true);
    // ES a modul-szintu konstans, amit NEM latott. Ez a lyuk, nev szerint.
    assert.equal(
      CATEGORY_LITERAL.test('const ENTITY_TYPE = "Category" as const;'),
      true,
    );
    // A NAGYBETUS alak tovabbra sem ugyanaz: a ket irasmod kulonbsege a tet.
    assert.equal(CATEGORY_LITERAL.test('entityType: "CATEGORY",'), false);
  });

  /**
   * A KOMMENT-SZURO KONTROLLJA. Enelkul a tagabb minta a szerzodest LEIRO
   * fejlecekre is riasztana, es a kovetkezo ember azt hinne, hogy egy
   * magyarazat is szabalysertes.
   */
  it("does not mistake a comment for a use", () => {
    const sample = [
      " * egy `ExternalReference` sort nalunk (`system: MEDUSA`, `entityType:",
      ' *      "Category"`, `entityId`: a mi azonositonk)',
      "/** A MI faank, a `Category` tablabol. */",
      // ES EGY IDEZOJELES egysoros JSDoc. EZ az az eset, amiert a nyito
      // komment-sor szurese letezik: a backtickes alakot a minta amugy sem
      // latja, tehat ha csak az allna itt, a szuro nem tudna elbukni.
      '/** a "Category" tabla neve */',
      '// const ENTITY_TYPE = "Category";',
      'const igazi = "Category";',
    ].join("\n");

    const kod = sample
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");

    assert.equal(CATEGORY_LITERAL.test(kod), true);
    assert.equal(kod.includes("ExternalReference"), false);
    assert.equal(kod.includes("const ENTITY_TYPE"), false);
    assert.equal(kod.includes("A MI faank"), false);
    // ES A BACKTICK NEM LITERAL-HATAROLO: a repo kommentjeiben az a TABLA nevet
    // jeloli, nem egy TypeScript stringet.
    assert.equal(CATEGORY_LITERAL.test("a `Category` tabla"), false);
  });

  it("reads the files it claims to read", async () => {
    const sources = await medusaSources();

    assert.ok(
      sources.length >= 10,
      `Csak ${sources.length} forrásfájlt találtam. Ez a keresés hibája, nem a lefedettségé.`,
    );
    // A ket erintett fajlnak NEV SZERINT benne kell lennie, kulonben a nulla
    // talalat azt jelentene, hogy nem is neztuk meg.
    assert.equal(sources.includes(POLICY_FILE), true);
    assert.equal(sources.includes(PROJECTION_CLI), true);
  });

  it("keeps the literal in one file, and everyone else calls the constant", async () => {
    const sources = await medusaSources();

    const sajatLiteral = sources.filter((file) =>
      CATEGORY_LITERAL.test(codeOf(file)),
    );

    assert.deepEqual(
      sajatLiteral,
      [POLICY_FILE],
      `Ezek a fájlok saját literált tartanak a közös kulcs helyett: ${sajatLiteral.join(", ")}`,
    );
  });

  /**
   * ES AZ ERTEK MAGA. Ez elsore tautologianak latszik -- a konstanst meri a
   * konstans ellen --, de nem az: azt ROGZITI, MELYIK irasmodot valasztottuk.
   * Ha valaki atirja, ez pirosra valt, es akkor fel lehet tenni a kerdest, ami
   * kulonben senkinek nem jutna eszebe: a tabla MASIK vege is atallt?
   */
  it("names the spelling both ends must share", () => {
    assert.equal(MEDUSA_CATEGORY_REFERENCE.system, "MEDUSA");
    assert.equal(MEDUSA_CATEGORY_REFERENCE.entityType, "Category");
  });
});

/**
 * PRODUCT BY PRODUCT (SEO P0 PR 10b). The pilot is a set of products: one in
 * the Acropora tree goes out from it, with its primary; its neighbour, not in
 * that tree, stays on the UNAS tree in the same run.
 */
describe("which tree a product is projected from", () => {
  const storeRows = [
    { storeCategoryId: "sc_szivattyu", isPrimary: false, sortOrder: 2 },
    { storeCategoryId: "sc_technika", isPrimary: true, sortOrder: 5 },
  ];
  const storeLinks = [
    { entityId: "sc_technika", externalId: "pcat_technika" },
    { entityId: "sc_szivattyu", externalId: "pcat_szivattyu" },
  ];

  it("a product in the Acropora tree goes out from it, with its primary", () => {
    const plan = planProductCategories(storeRows, ["cat_unas"]);
    assert.equal(plan.source, "STORE");
    assert.deepEqual(plan.reference, MEDUSA_STORE_CATEGORY_REFERENCE);
    assert.deepEqual(plan.osCategoryIds, ["sc_technika", "sc_szivattyu"]);

    const decision = decideProductCategories(plan, storeRows, storeLinks);
    assert.equal(decision.categories.kind, "complete");
    assert.deepEqual(decision.categories.medusaCategoryIds, [
      "pcat_technika",
      "pcat_szivattyu",
    ]);
    assert.equal(decision.primaryMedusaCategoryId, "pcat_technika");
  });

  it("a product with no row there stays on the UNAS tree, without a primary", () => {
    const plan = planProductCategories([], ["cat_unas"]);
    assert.equal(plan.source, "UNAS");
    assert.deepEqual(plan.reference, MEDUSA_CATEGORY_REFERENCE);
    assert.deepEqual(plan.osCategoryIds, ["cat_unas"]);

    const decision = decideProductCategories(
      plan,
      [],
      [{ entityId: "cat_unas", externalId: "pcat_unas" }],
    );
    assert.deepEqual(decision.categories.medusaCategoryIds, ["pcat_unas"]);
    assert.equal(decision.primaryMedusaCategoryId, null);
  });

  /**
   * ALL OR NOTHING ON THE NEW PATH TOO, AND THE PRIMARY WITH IT. The missing
   * link here is NOT the primary's, so a primary taken alone would still
   * resolve: it must not go out beside a held-back list.
   */
  it("one missing Acropora link holds back the list and the primary", () => {
    const plan = planProductCategories(storeRows, []);
    const decision = decideProductCategories(plan, storeRows, [
      { entityId: "sc_technika", externalId: "pcat_technika" },
    ]);
    assert.equal(decision.categories.kind, "incomplete");
    assert.deepEqual(decision.categories.missing, ["sc_szivattyu"]);
    assert.equal(decision.primaryMedusaCategoryId, null);
  });

  it("orders the primary first, then sortOrder, unset last, then id", () => {
    assert.deepEqual(
      orderedStoreCategoryIds([
        { storeCategoryId: "sc_c", isPrimary: false, sortOrder: null },
        { storeCategoryId: "sc_b", isPrimary: false, sortOrder: 1 },
        { storeCategoryId: "sc_a", isPrimary: false, sortOrder: 1 },
        { storeCategoryId: "sc_d", isPrimary: true, sortOrder: 9 },
      ]),
      ["sc_d", "sc_a", "sc_b", "sc_c"],
    );
  });

  it("no primary row gives no primary", () => {
    assert.equal(
      primaryMedusaCategoryId(
        [{ storeCategoryId: "sc_a", isPrimary: false, sortOrder: 0 }],
        [{ entityId: "sc_a", externalId: "pcat_a" }],
      ),
      null,
    );
  });
});
