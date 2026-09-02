import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MedusaAdminClient,
  MedusaCategoryInput,
  MedusaCategoryRow,
} from "./medusa-admin.client.js";
import {
  MedusaCategoryImportRefusedError,
  MedusaCategoryImportService,
} from "./medusa-category-import.service.js";
import type {
  MedusaCategoryLink,
  MedusaCategoryLinkRepository,
} from "./medusa-category-link.repository.js";
import type { OurCategoryNode } from "./medusa-category-tree.js";

const MOST = new Date("2026-09-02T22:00:00.000Z");

/** Ugyanaz, mint a `medusaDupla`, de a Medusa ELDOBJA az aktiv jelolot. */
function medusaDuplaAmiEldobjaAzAktivat() {
  const { client, letrehozva } = medusaDupla();
  const eredeti = client.createProductCategory.bind(client);
  client.createProductCategory = async (input) => {
    const sor = await eredeti(input);
    sor.is_active = false;
    return sor;
  };
  return { client, letrehozva };
}

/** A mi fank: egy gyoker es ket gyerek, a masodik a masodik szinten. */
const FA: OurCategoryNode[] = [
  { id: "cat_hal", parentId: "cat_gyoker", name: "Halak" },
  { id: "cat_gyoker", parentId: null, name: "Termékek" },
];

function medusaDupla(kezdo: MedusaCategoryRow[] = [], truncated = false) {
  const letrehozva: MedusaCategoryInput[] = [];
  const keletkezett: MedusaCategoryRow[] = [];
  let n = 0;
  const client = {
    /**
     * A MASODIK HIVAS A LETREHOZOTTAKAT IS LATJA. Enelkul a visszaolvasas
     * mindig nullat merne, es a hozza tartozo allitas nem tudna elbukni --
     * pontosan az a diszlet, amit a szolgaltatas el akar kerulni.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    async listProductCategories() {
      return { rows: [...kezdo, ...keletkezett], truncated };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async createProductCategory(input: MedusaCategoryInput) {
      letrehozva.push(input);
      n += 1;
      /**
       * A DUPLA A HIVO SZEMPONTJABOL KESZUL: a szolgaltatas a VISSZAKAPOTT
       * `id`-bol dolgozik tovabb (a gyerek szulojekent es a lekepezes-sorban),
       * tehat itt uj, felismerheto azonositot kell adni. Egy ures objektum a
       * sajat tesztjeit meg zolden hagyna.
       */
      const sor: MedusaCategoryRow = {
        id: `pcat_uj_${n}`,
        name: input.name,
        external_id: input.external_id,
        parent_category_id: input.parent_category_id ?? null,
        is_active: input.is_active,
      };
      keletkezett.push(sor);
      return sor;
    },
  } as unknown as MedusaAdminClient;
  return { client, letrehozva };
}

/**
 * A DUPLA TAROL, NEM CSAK NAPLOZ -- ES EZT A TESZT HOZTA ELO.
 *
 * Az elso valtozat csak a hivasokat jegyezte fel, az `all()` pedig mindig a
 * KEZDO halmazt adta vissza. A sajat tesztjei zoldek voltak tole, mert egyik
 * sem olvasta vissza. A hivo viszont IGEN: a futas vegen a lekepezes-sorok
 * szamat epp innen kerdezi, es a dupla nullat mondott volna arra, amit o maga
 * epp az elobb irt.
 *
 * Ugyanaz a hibafajta, amit a lapunk igy mond: amit a hivo hasznal, de a teszt
 * nem allit, az a dupla biztos hibaja.
 */
function taroloDupla(kezdo: MedusaCategoryLink[] = []) {
  const hivasok: { fajta: "link" | "relink"; par: [string, string] }[] = [];
  const sorok = [...kezdo];
  const rogzit = (categoryId: string, medusaCategoryId: string) => {
    const meglevo = sorok.findIndex((l) => l.categoryId === categoryId);
    const uj = { categoryId, medusaCategoryId, lastSyncedAt: MOST };
    if (meglevo === -1) sorok.push(uj);
    else sorok[meglevo] = uj;
    return uj;
  };
  const links = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async all() {
      return [...sorok];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async link(categoryId: string, medusaCategoryId: string) {
      hivasok.push({ fajta: "link", par: [categoryId, medusaCategoryId] });
      return rogzit(categoryId, medusaCategoryId);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async relink(categoryId: string, medusaCategoryId: string) {
      hivasok.push({ fajta: "relink", par: [categoryId, medusaCategoryId] });
      return rogzit(categoryId, medusaCategoryId);
    },
  } as unknown as MedusaCategoryLinkRepository;
  return { links, hivasok };
}

describe("a kategóriafa betöltése", () => {
  it("üres Medusába mindet létrehozza, és a gyerek a SZÜLŐ MEDUSA-azonosítóját kapja", async () => {
    const { client, letrehozva } = medusaDupla();
    const { links, hivasok } = taroloDupla();
    const service = new MedusaCategoryImportService(links);

    const report = await service.run(client, FA, MOST);

    // A SORREND: a gyoker eloszor, akkor is, ha a bemenetben masodik allt.
    assert.deepEqual(
      letrehozva.map((i) => i.external_id),
      ["cat_gyoker", "cat_hal"],
    );
    // A MEZO NEVE `name`, nem `title`. A Medusa szerzodese ezt varja.
    assert.equal(letrehozva[0]!.name, "Termékek");
    assert.equal(letrehozva[1]!.name, "Halak - Termékek");
    /*
      EZ A LENYEG. A gyerek szuloje NEM a mi azonositonk, hanem az elozo
      hivasban KELETKEZETT Medusa-azonosito. Ha a szolgaltatas a sajat
      azonositonkat kuldene tovabb, a Medusa vagy elutasitana, vagy - ami
      rosszabb - gyokerkent hozna letre az egesz agat.
    */
    assert.equal(letrehozva[0]!.parent_category_id, null);
    assert.equal(letrehozva[1]!.parent_category_id, "pcat_uj_1");
    /*
      AZ AKTIV JELOLO KIMEGY, ES IGAZ ERTEKKEL. A Medusa alapertelmezese
      `false` (merve a modelljeben), tehat ha ez az allitas elhal, a betoltes
      219 LATHATATLAN kategoriat hozna letre -- egy futas, ami sikeresnek
      latszik es semmit nem szallit.
    */
    assert.equal(letrehozva[0]!.is_active, true);
    assert.equal(letrehozva[1]!.is_active, true);

    assert.deepEqual(hivasok, [
      { fajta: "link", par: ["cat_gyoker", "pcat_uj_1"] },
      { fajta: "link", par: ["cat_hal", "pcat_uj_2"] },
    ]);
    assert.equal(report.created, 2);
    assert.deepEqual(report.conflicts, []);
  });

  it("a futás VISSZAOLVASSA a saját eredményét", async () => {
    const { client } = medusaDupla();
    const { links } = taroloDupla();
    const service = new MedusaCategoryImportService(links);
    const report = await service.run(client, FA, MOST);
    assert.deepEqual(report.verification, {
      carryingOurId: 2,
      activeAmongThem: 2,
      mappingRowsHere: 2,
      expected: 2,
    });
  });

  it("ha a Medusa NEM tárolta el az aktív jelölőt, az ellenőrzés meglátja", async () => {
    /*
      EZ AZ EGYETLEN HELY, AHOL EZ A HIBA LATSZIK. A betoltes `is_active: true`
      erteket kuld; ha a Medusa eldobja, MINDEN mas szam helyes marad: 219
      kategoria all, mindegyiken a mi azonositonk, a fa alakja jo, es a masodik
      futas is 219-et hagy. Csak epp senki nem latja oket.
    */
    const { client } = medusaDuplaAmiEldobjaAzAktivat();
    const { links } = taroloDupla();
    const service = new MedusaCategoryImportService(links);
    const report = await service.run(client, FA, MOST);
    assert.equal(report.verification.carryingOurId, 2);
    assert.equal(report.verification.activeAmongThem, 0);
    // ES A TOBBI SZAM VALTOZATLANUL HELYES -- ez a lenyeg.
    assert.equal(report.created, 2);
    assert.equal(report.verification.mappingRowsHere, 2);
  });

  it("csonkolt listánál MEGÁLL, és semmit nem ír", async () => {
    const { client, letrehozva } = medusaDupla([], true);
    const { links, hivasok } = taroloDupla();
    const service = new MedusaCategoryImportService(links);

    await assert.rejects(
      () => service.run(client, FA, MOST),
      MedusaCategoryImportRefusedError,
    );
    /*
      A HIBAUZENET MEGLETE NEM BIZONYITEK. Egy orzot az minosit, hogy NEM
      TORTENT SEMMI: nulla letrehozas es nulla lekepezes-iras. Ez a ketto az
      allitas, a kivetel csak a keret.
    */
    assert.equal(letrehozva.length, 0);
    assert.equal(hivasok.length, 0);
  });

  it("ami már áll a Medusában, arra CSAK a leképezés-sort írja meg", async () => {
    const { client, letrehozva } = medusaDupla([
      {
        id: "pcat_meglevo",
        name: "Termékek",
        external_id: "cat_gyoker",
        parent_category_id: null,
        is_active: true,
      },
    ]);
    const { links, hivasok } = taroloDupla();
    const service = new MedusaCategoryImportService(links);

    const report = await service.run(client, FA, MOST);

    // A gyokeret NEM hozza letre masodszor.
    assert.deepEqual(
      letrehozva.map((i) => i.external_id),
      ["cat_hal"],
    );
    // ES A GYEREK A MAR MEGLEVO SZULO azonositojat kapja, nem ujat.
    assert.equal(letrehozva[0]!.parent_category_id, "pcat_meglevo");
    assert.deepEqual(hivasok, [
      { fajta: "link", par: ["cat_gyoker", "pcat_meglevo"] },
      { fajta: "link", par: ["cat_hal", "pcat_uj_1"] },
    ]);
    assert.equal(report.linkedOnly, 1);
    assert.equal(report.created, 1);
  });

  it("elavult leképezésnél újra létrehoz, és RELINK-el, nem link-el", async () => {
    const { client } = medusaDupla();
    const { links, hivasok } = taroloDupla([
      {
        categoryId: "cat_gyoker",
        medusaCategoryId: "pcat_torolt",
        lastSyncedAt: null,
      },
    ]);
    const service = new MedusaCategoryImportService(links);

    const report = await service.run(client, FA, MOST);

    /*
      A KULONBSEG NEM KOZOMBOS. A `link` szandekosan MEGTAGADJA a felulirast,
      tehat ha itt `link` menne, a betoltes eles futasban allna meg az elso
      elavult sornal - egy utkozes-hibaval, ami ellen a terv mar dontott.
    */
    assert.deepEqual(hivasok[0], {
      fajta: "relink",
      par: ["cat_gyoker", "pcat_uj_1"],
    });
    assert.equal(report.relinked, 1);
    assert.equal(report.created, 1);
  });

  it("ütközésnél jelenti, és hozzá NEM nyúl", async () => {
    const { client, letrehozva } = medusaDupla([
      {
        id: "pcat_uj_hordozza",
        name: "Termékek",
        external_id: "cat_gyoker",
        parent_category_id: null,
        is_active: true,
      },
    ]);
    const { links, hivasok } = taroloDupla([
      {
        categoryId: "cat_gyoker",
        medusaCategoryId: "pcat_regi",
        lastSyncedAt: null,
      },
    ]);
    const service = new MedusaCategoryImportService(links);

    const report = await service.run(client, FA, MOST);

    assert.deepEqual(report.conflicts, ["cat_gyoker"]);
    // AZ UTKOZO TETELRE nulla iras: sem letrehozas, sem lekepezes.
    assert.equal(
      letrehozva.filter((i) => i.external_id === "cat_gyoker").length,
      0,
    );
    assert.equal(hivasok.filter((h) => h.par[0] === "cat_gyoker").length, 0);
    /*
      ES A GYEREKE SEM MEGY AT. Ezt a teszt irasa hozta elo: az elso valtozat
      letrehozta a "Halak" agat, es szulojenek azt a Medusa-kategoriat adta,
      amelyik a mi azonositonkat hordozza -- vagyis EPP azt tippelte meg, amirol
      az utkozes kimondta, hogy nem tudjuk.

      Egy elmaradt ag hangos: valaki keresi a besorolast, es nincs. Egy rossz
      szulo ala kerult ag nema: ott van, csak mashol.
    */
    assert.deepEqual(report.blockedByConflict, ["cat_hal"]);
    assert.equal(letrehozva.length, 0);
    assert.equal(hivasok.length, 0);
  });

  it("a helyes menetben SEMMI nem blokkolódik", async () => {
    /*
      ISMERT POZITIV KONTROLL A FENTI ALLITASHOZ. A `blockedByConflict` lista
      nem attol helyes, hogy utkozesnel megtelik, hanem attol, hogy egy helyes
      menetben URES marad. Enelkul egy "mindig blokkol" valtozat is atmenne a
      fenti alliltason.
    */
    const { client, letrehozva } = medusaDupla();
    const { links } = taroloDupla();
    const service = new MedusaCategoryImportService(links);
    const report = await service.run(client, FA, MOST);
    assert.deepEqual(report.blockedByConflict, []);
    assert.equal(letrehozva.length, 2);
  });
});
