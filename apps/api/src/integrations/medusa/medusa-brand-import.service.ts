import { Injectable } from "@nestjs/common";

import type {
  MedusaAdminClient,
  MedusaCollectionRow,
} from "./medusa-admin.client.js";
import { MedusaBrandLinkRepository } from "./medusa-brand-link.repository.js";
import {
  planBrandImport,
  type BrandImportPlan,
  type OurBrand,
} from "./medusa-brand-plan.js";

/**
 * A MARKAK BETOLTESE A MEDUSARA, GYUJTEMENYKENT.
 *
 * A sorrend nem esetleges: eloszor a KET oldal teljes kepe, abbol a terv, es
 * csak azutan irunk barhova. Egy soronkent kerdezo valtozat ugyanezt adna a
 * legtobb esetben, de a terv hat allapotat nem tudna eldonteni, mert azokhoz
 * mindket oldal EGYUTTES kepe kell.
 */

/** A betoltes megtagadasa: a bemenet vagy a cel oldali kep alkalmatlan. */
export class MedusaBrandImportRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`MEDUSA_BRAND_IMPORT_REFUSED: ${reason}`);
  }
}

export interface BrandImportReport {
  created: number;
  linkedOnly: number;
  relinked: number;
  skipped: number;
  skippedArchived: string[];
  conflicts: string[];
  /** A handle-t foglalo, a terv altal nem feldolgozhato markak (azonositok): nem hoztuk letre, nem kotottuk ossze oket. */
  handleTaken: string[];
  /**
   * AMELYIK MARKANAL A MUVELET ELBUKOTT, MARKANKENT (kartya ec82b629): egy marka hibaja nem allitja le a tobbit. Korabban az
   * elso hiba (egy mar letezo handle) kivetelkent kiszallt a ciklusbol, es a hatralevo markak sem kaptak gyujtemenyt, a lepes
   * eredmenye pedig egyetlen hibasor volt -- azt nem lehetett latni, MELYIK marka es MI bukott.
   */
  failures: BrandImportFailure[];
  verification: BrandImportVerification;
}

export interface BrandImportFailure {
  ourId: string;
  phase: "link" | "create" | "relink";
  /** A hiba rovid szovege (azonosito es titok nelkul, a hosszat korlatozza a hivo). */
  message: string;
}

/**
 * A VISSZAOLVASAS SZAMAI.
 *
 * Nem sajat konyveles: a futas VEGEN ujra lekerdezett listabol keszul. Egy
 * konyvelt szam (amit letrehoztunk, azt hozzaadjuk) ugyanazt adna, es semmit
 * nem MERNE -- azt allitana, hogy megtortent az, amit mi magunk kertunk.
 */
export interface BrandImportVerification {
  /** Hany gyujtemeny viseli a Medusan a mi kulso azonositonkat. */
  carryingOurId: number;
  /** Hany lekepezes-sor all nalunk. */
  mappingRowsHere: number;
  /** Hany aktiv markat vartunk el osszesen. */
  expected: number;
}

@Injectable()
export class MedusaBrandImportService {
  constructor(private readonly links: MedusaBrandLinkRepository) {}

  /** A terv onmagaban, iras nelkul. Ugyanaz a menet, csak megall a dontesnel. */
  async plan(
    client: MedusaAdminClient,
    brands: readonly OurBrand[],
  ): Promise<BrandImportPlan> {
    const lista = await client.listProductCollections();
    /**
     * A CSONKOLT LISTA MEGALLIT, ES EZ NEM OVATOSSAG.
     *
     * Egy csonkolt lista ugyanugy nez ki, mint egy teljes. Ha a terv rajta
     * dontene, azokat a markakat akarna LETREHOZNI, amik csak a lista levagott
     * vegen alltak -- es a Medusan ket gyujtemeny keletkezne ugyanarra.
     */
    if (lista.truncated)
      throw new MedusaBrandImportRefusedError(
        "a Medusa gyűjtemény-listája kimerítette a limitet, a terv csonkolt halmazon döntene",
      );
    return planBrandImport(
      brands,
      lista.rows.map(tervAlak),
      (await this.links.all()).map((sor) => ({
        ourId: sor.brandId,
        medusaId: sor.medusaCollectionId,
      })),
    );
  }

  /**
   * A TELJES BETOLTES, EGY MENETBEN.
   *
   * AZ UTKOZO MARKA KIMARAD, es semmi mas nem epul ra -- ellentetben a
   * kategoria-fával, ahol egy utkozo szulo a gyerekeit is blokkolja. A markak
   * kozott nincs ilyen fuggoseg, tehat egy utkozes pontosan egy markat visz el.
   */
  async run(
    client: MedusaAdminClient,
    brands: readonly OurBrand[],
    now: Date,
  ): Promise<BrandImportReport> {
    const terv = await this.plan(client, brands);

    const report: BrandImportReport = {
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      skipped: terv.skip.length,
      skippedArchived: terv.skipArchived,
      conflicts: terv.conflict.map((c) => c.ourId),
      handleTaken: terv.handleTaken.map((h) => h.ourId),
      failures: [],
      verification: {
        carryingOurId: 0,
        mappingRowsHere: 0,
        expected: brands.length - terv.skipArchived.length,
      },
    };

    for (const par of terv.mapOnly) {
      try {
        await this.links.link(par.ourId, par.medusaId, now);
        report.linkedOnly += 1;
      } catch (error) {
        report.failures.push(hiba(par.ourId, "link", error));
      }
    }

    const elavult = new Set(terv.staleMapping);
    for (const teendo of terv.create) {
      /**
       * A LETREHOZAS ES A LEKEPEZES KET KULON LEPES, ES MARKANKENT KULON IS BUKHAT. Ha a letrehozas bukik, a marka nem kap sort
       * (nincs mit lekepezni). Ha a letrehozas sikerult, a lekepezes viszont nem, a gyujtemeny mar all a Medusan a mi kulso
       * azonositonkkal: a KOVETKEZO kor ezt `mapOnly`-kent latja, es osszekoti -- nem hoz letre masodikat.
       */
      let created: MedusaCollectionRow;
      try {
        created = await client.createProductCollection({
          title: teendo.title,
          handle: teendo.handle,
          external_id: teendo.ourId,
        });
      } catch (error) {
        report.failures.push(hiba(teendo.ourId, "create", error));
        continue;
      }
      /**
       * ELAVULT SORNAL `relink`, EGYEBKENT `link`. A kulonbseg nem kenyelmi: a
       * `link` szandekosan megtagadja a felulirast, es itt a terv MERTE, hogy a
       * regi azonosito nincs a Medusa gyujtemenyei kozott.
       */
      try {
        if (elavult.has(teendo.ourId)) {
          await this.links.relink(teendo.ourId, created.id, now);
          report.relinked += 1;
        } else {
          await this.links.link(teendo.ourId, created.id, now);
          report.created += 1;
        }
      } catch (error) {
        report.failures.push(
          hiba(
            teendo.ourId,
            elavult.has(teendo.ourId) ? "relink" : "link",
            error,
          ),
        );
      }
    }

    /**
     * A VISSZAOLVASAS UJABB LEKERDEZES, ES EZ SZANDEKOS: a futas ELEJEN lekert
     * lista a vegere elavult -- epp azokat nem tartalmazza, amiket mi hoztunk
     * letre.
     */
    const utana = await client.listProductCollections();
    const sajatAzonositok = new Set(
      brands
        .filter((brand) => !terv.skipArchived.includes(brand.id))
        .map((brand) => brand.id),
    );
    report.verification.carryingOurId = utana.rows.filter(
      (sor) => sor.external_id && sajatAzonositok.has(sor.external_id),
    ).length;
    report.verification.mappingRowsHere = (await this.links.all()).filter(
      (sor) => sajatAzonositok.has(sor.brandId),
    ).length;

    return report;
  }
}

const FAILURE_MESSAGE_MAX = 160;

function hiba(
  ourId: string,
  phase: BrandImportFailure["phase"],
  error: unknown,
): BrandImportFailure {
  const text = error instanceof Error ? error.message : String(error);
  return {
    ourId,
    phase,
    message: text.replace(/\s+/g, " ").trim().slice(0, FAILURE_MESSAGE_MAX),
  };
}

function tervAlak(sor: MedusaCollectionRow) {
  return { id: sor.id, handle: sor.handle, externalId: sor.external_id };
}
