import { Injectable } from "@nestjs/common";

import type {
  MedusaAdminClient,
  MedusaCategoryRow,
} from "./medusa-admin.client.js";
import {
  MedusaCategoryLinkRepository,
  type MedusaCategoryLink,
} from "./medusa-category-link.repository.js";
import {
  categoryRowsFromOurTree,
  firstOutOfOrder,
  planCategoryImport,
  type CategoryImportPlan,
  type CategoryRow,
  type CategoryMapping,
  type ExistingCategory,
  type OurCategoryNode,
} from "./medusa-category-tree.js";

/**
 * A KATEGORIAFA ATVITELE: a VEGREHAJTAS resze. A dontest a
 * `medusa-category-tree.ts` hozza, ez a fajl csak elvegzi.
 *
 * A ket resz azert all kulon, mert MAS bizonyitja oket. A tervet meg lehet
 * merni halozat nelkul, tetelesen; ezt a reszt csak ugy, hogy a Medusa oldalat
 * teszt-duplaval helyettesitjuk. Ha egyben allnanak, a terv allitasai is
 * duplan allnanak, es a duplaval szemben allitani gyengebb.
 */

/**
 * A DROTALAK ES A TERV ALAKJA KULON MARAD, ES A FORDITO EPP ERRE FIGYELMEZTETETT.
 *
 * A Medusa `external_id` neven adja vissza, a terv `externalId` neven varja. A
 * ket nev kozott egy `as` kaszt is atvitt volna -- es akkor a mezo `undefined`
 * lenne minden soron, a terv pedig azt latna, hogy EGYETLEN kategorian sincs
 * kulso azonosito. A kovetkezmeny nem hiba lenne, hanem 219 duplikatum.
 *
 * Ezert all itt egy megnevezett fuggveny: a leképezes latszik, es ha a Medusa
 * atnevezi a mezot, ez az egy sor pirosodik ki.
 */
function tervAlak(row: MedusaCategoryRow): ExistingCategory {
  return { id: row.id, externalId: row.external_id };
}

/**
 * A MASIK VARRAT, ugyanabbol az okbol. A tarolo a sajat szavaival beszel
 * (`categoryId`, `medusaCategoryId`), a terv a magaeval (`ourId`, `medusaId`).
 * Itt a tevedes MEG csendesebb lenne, mint a masik varraton: ket sztring-mezo,
 * felcserelheto sorrendben. Egy megnevezett fuggveny mellett a felcsereles
 * pirosodik; egy inline objektum-literalban nem feltetlenul.
 */
function tervLekepezes(link: MedusaCategoryLink): CategoryMapping {
  return { ourId: link.categoryId, medusaId: link.medusaCategoryId };
}

export class MedusaCategoryImportRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`MEDUSA_CATEGORY_IMPORT_REFUSED: ${reason}`);
  }
}

export interface CategoryImportReport {
  created: number;
  /** Mar allt a Medusaban, csak a lekepezes-sor hianyzott. */
  linkedOnly: number;
  /** Elavult lekepezes-sor, ujra letrehozva es atirva. */
  relinked: number;
  skipped: number;
  /** Amiket a terv utkozesnek jelolt: ERINTETLENUL maradtak. */
  conflicts: string[];
  /**
   * Amik azert maradtak ki, mert a SZULOJUK utkozik vagy nem oldodott fel.
   * Nem hiba, hanem kovetkezmeny: egy ag nem vihetо at a gyokere nelkul.
   */
  blockedByConflict: string[];
}

@Injectable()
export class MedusaCategoryImportService {
  constructor(private readonly links: MedusaCategoryLinkRepository) {}

  /**
   * A TELJES BETOLTES, EGY MENETBEN.
   *
   * A sorrend nem esetleges: eloszor a KET oldal teljes kepet vesszuk fel,
   * abbol keszul a terv, es csak azutan irunk barhova. Egy soronkent kerdezo
   * valtozat ugyanezt az eredmenyt adna a legtobb esetben, de a terv ot
   * allapotat nem tudna eldonteni, mert azokhoz mindket oldal EGYUTTES kepe
   * kell.
   */
  async run(
    client: MedusaAdminClient,
    nodes: readonly OurCategoryNode[],
    now: Date,
  ): Promise<CategoryImportReport> {
    const rows = categoryRowsFromOurTree(nodes);
    /**
     * A `categoryRowsFromOurTree` mar szulo-eloszor rendez, tehat ez ma nem
     * tud elbukni. MEGIS ITT ALL, mert a `run` a sorrendre EPIT (a szulo
     * Medusa-azonositoja a gyerek letrehozasakor mar kell), es ez az allitas
     * a fuggoseget mondja ki. Ha valaki mashonnan tolti fel a sorokat, itt all
     * meg, nem a huszonharmadik kategorianal, egy ertelmezhetetlen hibaval.
     */
    const rossz = firstOutOfOrder(rows);
    if (rossz)
      throw new MedusaCategoryImportRefusedError(
        `a(z) ${rossz} kategória a szülője előtt áll`,
      );

    const lista = await client.listProductCategories();
    /**
     * A CSONKOLT LISTA MEGALLIT, ES EZ A FAIL-CLOSED IRANY.
     *
     * Egy csonkolt listabol a terv azt olvasna ki, hogy a kategoria meg nincs
     * a Medusaban, es letrehozna masodszor is. A hianyzo kategoria hangos (a
     * besorolas nem jelenik meg), a duplikatum viszont NEMA: ket kategoria all
     * ugyanazzal a nevvel, es csak az egyiken vannak termekek.
     */
    if (lista.truncated)
      throw new MedusaCategoryImportRefusedError(
        "a Medusa kategória-listája kimerítette a limitet, a terv csonkolt halmazon döntene",
      );

    const terv = planCategoryImport(
      rows,
      lista.rows.map(tervAlak),
      (await this.links.all()).map(tervLekepezes),
    );

    const medusaAzonosito = new Map<string, string>();
    for (const cat of lista.rows)
      if (cat.external_id) medusaAzonosito.set(cat.external_id, cat.id);

    const report: CategoryImportReport = {
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      skipped: terv.skip.length,
      conflicts: terv.conflict.map((c) => c.ourId),
      blockedByConflict: [],
    };

    for (const par of terv.mapOnly) {
      await this.links.link(par.ourId, par.medusaId, now);
      medusaAzonosito.set(par.ourId, par.medusaId);
      report.linkedOnly += 1;
    }

    const elavult = new Set(terv.staleMapping);
    /**
     * AZ UTKOZO KATEGORIA GYEREKEIT SEM VISSZUK AT, ES EZ A TESZTIRAS KOZBEN
     * DERULT KI.
     *
     * Az elso valtozat a gyereket letrehozta, es a szulojenek azt a
     * Medusa-azonositot adta, amelyik a mi azonositonkat hordozza. Ez egy
     * TIPP: epp azt az allapotot neveztuk utkozesnek, amiben nem tudjuk, melyik
     * kategoria a mienk.
     *
     * ES MEG ROSSZABB VOLT A `?? null` AG: ha a szulo azonositoja nem oldodott
     * fel, a gyerek GYOKERKENT jott volna letre. Nem hibaval -- egy uj gyoker
     * a fa tetejen, a Medusa boldogan elfogadja.
     *
     * A ket teves irany ara nem egyforma. Egy elmaradt ag HANGOS: valaki
     * keresi a besorolast, es nincs. Egy rossz szulo alatt allo ag NEMA: ott
     * van, csak mashol, es senki nem keresi ott. Ezert a feloldatlan szulo
     * MEGALLITJA az agat, es a jelentes megnevezi.
     */
    const blokkolt = new Set(terv.conflict.map((c) => c.ourId));
    for (const teendo of terv.create) {
      if (teendo.parentOurId && blokkolt.has(teendo.parentOurId)) {
        blokkolt.add(teendo.ourId);
        report.blockedByConflict.push(teendo.ourId);
        continue;
      }
      const szulo = teendo.parentOurId
        ? (medusaAzonosito.get(teendo.parentOurId) ?? null)
        : null;
      if (teendo.parentOurId && !szulo) {
        blokkolt.add(teendo.ourId);
        report.blockedByConflict.push(teendo.ourId);
        continue;
      }
      const created: MedusaCategoryRow = await client.createProductCategory({
        name: teendo.title,
        external_id: teendo.ourId,
        parent_category_id: szulo,
      });
      medusaAzonosito.set(teendo.ourId, created.id);
      /**
       * ELAVULT SORNAL `relink`, EGYEBKENT `link`. A kulonbseg nem kenyelmi:
       * a `link` szandekosan megtagadja a felulirast, es itt a terv MERTE,
       * hogy a regi azonosito nincs a Medusa kategoriai kozott.
       */
      if (elavult.has(teendo.ourId)) {
        await this.links.relink(teendo.ourId, created.id, now);
        report.relinked += 1;
      } else {
        await this.links.link(teendo.ourId, created.id, now);
        report.created += 1;
      }
    }

    return report;
  }

  /** A terv onmagaban, iras nelkul. Ugyanaz a menet, csak megall a dontesnel. */
  async plan(
    client: MedusaAdminClient,
    nodes: readonly OurCategoryNode[],
  ): Promise<{ plan: CategoryImportPlan; rows: CategoryRow[] }> {
    const rows = categoryRowsFromOurTree(nodes);
    const lista = await client.listProductCategories();
    if (lista.truncated)
      throw new MedusaCategoryImportRefusedError(
        "a Medusa kategória-listája kimerítette a limitet, a terv csonkolt halmazon döntene",
      );
    return {
      plan: planCategoryImport(
        rows,
        lista.rows.map(tervAlak),
        (await this.links.all()).map(tervLekepezes),
      ),
      rows,
    };
  }
}
