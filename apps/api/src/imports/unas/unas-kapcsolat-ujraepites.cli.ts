import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  kapcsolatHivatkozasok,
  type KapcsolatFajta,
} from "./unas-kapcsolat-hivatkozasok.js";
import { resolveSimilarProducts } from "./unas-similar-products.mapping.js";

/**
 * A TERMEK-KAPCSOLATOK TELJES UJRAEPITESE -- EGYSZER, MINDEN TERMEKRE.
 *
 * === MIERT KELL, HOLOTT A SZINKRON IS IR ===
 *
 * A szinkron a kapcsolatokat a TERMEK IRASAHOZ koti: csak arra a termekre irja
 * oket, amit az adott futas letrehozott vagy modositott. A valtozatlan termek
 * kimarad -- es ez MODFUGGETLEN: a teljes osszevetes sem irja ujra, mert ott is
 * ugyanaz a `if (diff.action === "UNCHANGED") continue;` all.
 *
 * Vagyis a hianyt MA egyetlen futasi mod sem zarja le. A hasonlo ag 2026-09-04
 * ota ir (#543), a kiegeszito 2026-09-08 ota (#615): azota is csak azok a
 * termekek kaptak kapcsolatot, amik kozben megvaltoztak. A stage-en 1310
 * forras-termekbol 56-nak van kapcsolat-sora.
 *
 * EGY EGYSZERI ADOSSAGOT EGYSZERI FUTASSAL kell torleszteni (acrobot dontese,
 * 2026-09-15). A masik irany rosszabb lenne: minden futasban minden termek
 * osszes kapcsolatat ujrairni akkor is, amikor a forras-adat beture ugyanaz.
 *
 * === ES NEM KELL HOZZA EGYETLEN UNAS-HIVAS SEM ===
 *
 * Az adat mar nalunk van: a `UnasProductSnapshot.rawPayload` a `nodePayload`
 * muve, ami REKURZIV -- a teljes fat megtartja, eredeti CamelCase nevekkel. A
 * `SimilarProducts` es az `AdditionalProducts` ott all, `Id`, `Sku`, `Name`
 * mezokkel. A kiolvasas szabalya egy helyen all
 * (`unas-kapcsolat-hivatkozasok.ts`), a FELOLDAS pedig ugyanaz a tiszta
 * fuggveny, amit a szinkron hasznal (`resolveSimilarProducts`) -- tehat az
 * onhivatkozas, a duplikatum es a feloldatlan hivatkozas ITT IS ugyanugy szamit.
 *
 * === AMIT NEM CSINAL ===
 *
 * Nem hiv halozatot, es `--apply` nelkul nem ir semmit. Az iras termekenkent es
 * fajtankent TOROL, majd UJRAIR -- ugyanaz a sorrend, amit a szinkron hasznal,
 * tehat egy masodik futas ugyanazt az allapotot allitja elo (idempotens).
 *
 * KILEPESI KODOK
 *   0  lefutott (akar nulla uj sorral)
 *   1  a futas hibara futott
 */
export interface CliOutput {
  stdout: (t: string) => void;
  stderr: (t: string) => void;
}

/** Egy termek, ahogy a parancs latja: az azonositoi es a tarolt pillanatkep. */
export interface UjraepitesJelolt {
  productId: string;
  externalId: string;
  rawPayload: unknown;
}

export interface UjraepitesDeps {
  /** A termekek, amiknek van UNAS-tukre. */
  jeloltek(): Promise<UjraepitesJelolt[]>;
  /**
   * A TELJES KATALOGUS kulso azonosito -> termek terkepe.
   *
   * A TELJESSEG NEM ELOVIGYAZATOSSAG: a hivatkozasok celpontjai tulnyomoreszt
   * MAS termekek, mint amit epp feldolgozunk. Egy szukebb terkep majdnem
   * minden hivatkozast feloldatlanul hagyna -- es mivel az iras TOROL, mielott
   * ujrair, a meglevo kapcsolatok is ELTUNNENEK.
   */
  terkep(): Promise<Map<string, string>>;
  /** A tenyleges iras. CSAK `--apply` mellett hivodik. */
  ir(input: {
    sourceProductId: string;
    fajta: KapcsolatFajta;
    celProductIdk: readonly string[];
  }): Promise<number>;
}

export interface UjraepitesSzamok {
  termek: number;
  hivatkozastVisel: number;
  irhatoKapcsolat: number;
  feloldatlan: number;
  onhivatkozas: number;
  duplikatum: number;
  azonositoNelkul: number;
}

const FAJTAK: readonly KapcsolatFajta[] = ["SIMILAR", "ACCESSORY"];
/** Ennyi feloldatlan hivatkozast sorolunk fel nevvel; a TELJES szam mellette áll. */
const MINTA = 10;

export async function runKapcsolatUjraepitesCli(
  argv: readonly string[],
  out: CliOutput,
  deps: UjraepitesDeps,
): Promise<number> {
  /**
   * TERV ALAPBOL, IRAS CSAK KERESRE -- a repo bevett alakja.
   *
   * ES ITT KULONOSEN INDOKOLT: az iras TOROL, mielott ujrair. Egy elso futas,
   * amit nem lehet elotte megnezni, olyan sorokat vinne el, amiket a szinkron
   * irt -- es a terv-ag epp azt mutatja meg, hogy a helyukre ugyanaz kerulne-e.
   */
  const apply = argv.includes("--apply");
  try {
    const [jeloltek, terkep] = await Promise.all([
      deps.jeloltek(),
      deps.terkep(),
    ]);

    const szamok: Record<KapcsolatFajta, UjraepitesSzamok> = {
      SIMILAR: uresSzamok(),
      ACCESSORY: uresSzamok(),
    };
    const minta: Record<KapcsolatFajta, string[]> = {
      SIMILAR: [],
      ACCESSORY: [],
    };

    for (const jelolt of jeloltek) {
      for (const fajta of FAJTAK) {
        const szam = szamok[fajta];
        szam.termek += 1;
        const olvasas = kapcsolatHivatkozasok(jelolt.rawPayload, fajta);
        szam.azonositoNelkul += olvasas.azonositoNelkul;
        if (olvasas.hivatkozasok.length === 0) continue;
        szam.hivatkozastVisel += 1;

        /**
         * A FELOLDAS UGYANAZ A FUGGVENY, AMIT A SZINKRON HASZNAL.
         *
         * A neve hasonlo termeket mond, a munkaja viszont fajta-fuggetlen: egy
         * hivatkozas-listat old fel termek-azonositokra. Egy sajat masolat itt
         * pontosan azt a harom kulonbseget csuszatna el (onhivatkozas,
         * duplikatum, feloldatlan), amirol a szamok szolnak.
         */
        const mapping = resolveSimilarProducts({
          sourceExternalId: jelolt.externalId,
          sourceProductId: jelolt.productId,
          similarProducts: olvasas.hivatkozasok,
          productIdsByExternalId: terkep,
        });
        szam.feloldatlan += mapping.unresolved.length;
        szam.onhivatkozas += mapping.selfReferences;
        szam.duplikatum += mapping.duplicates;
        for (const hianyzo of mapping.unresolved)
          if (minta[fajta].length < MINTA)
            minta[fajta].push(
              `${jelolt.externalId}->${hianyzo.externalId} (${hianyzo.sku})`,
            );

        if (mapping.targets.length === 0) continue;
        szam.irhatoKapcsolat += apply
          ? await deps.ir({
              sourceProductId: jelolt.productId,
              fajta,
              celProductIdk: mapping.targets.map((cel) => cel.productId),
            })
          : mapping.targets.length;
      }
    }

    out.stdout(
      `${apply ? "Megírva" : "Terv"}: ${jeloltek.length} termék, ` +
        `${terkep.size} külső azonosító a térképen.\n`,
    );
    for (const fajta of FAJTAK) {
      const szam = szamok[fajta];
      out.stdout(
        `  ${fajta}: ${szam.irhatoKapcsolat} kapcsolat ` +
          `${szam.hivatkozastVisel} terméken; feloldatlan ${szam.feloldatlan}, ` +
          `önhivatkozás ${szam.onhivatkozas}, duplikátum ${szam.duplikatum}, ` +
          `azonosító nélkül ${szam.azonositoNelkul}.\n`,
      );
      if (minta[fajta].length > 0)
        out.stdout(`    minta: ${minta[fajta].join(", ")}\n`);
    }
    if (!apply)
      out.stdout(
        "Nem írtam semmit. Az `--apply` kapcsolóval fut le élesben.\n",
      );

    return 0;
  } catch (error) {
    out.stderr(`A kapcsolat-újraépítés elhasalt: ${String(error)}\n`);
    return 1;
  }
}

function uresSzamok(): UjraepitesSzamok {
  return {
    termek: 0,
    hivatkozastVisel: 0,
    irhatoKapcsolat: 0,
    feloldatlan: 0,
    onhivatkozas: 0,
    duplikatum: 0,
    azonositoNelkul: 0,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  /**
   * ITT KOTODIK OSSZE A PARANCS A VALODI ADATBAZISSAL, es CSAK itt.
   *
   * A torzs semmit nem tud a Prismarol: ezert lehet fixture-on merni, es ezert
   * bizonyithato, hogy `--apply` nelkul nem ir -- az `ir` varratot nem hivjuk.
   */
  const code = await runKapcsolatUjraepitesCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      jeloltek: async () =>
        (
          await prisma.unasProductSnapshot.findMany({
            select: { productId: true, externalId: true, rawPayload: true },
          })
        ).map((sor) => ({
          productId: sor.productId,
          externalId: sor.externalId,
          rawPayload: sor.rawPayload,
        })),
      terkep: async () =>
        new Map(
          (
            await prisma.externalReference.findMany({
              where: { system: "UNAS", entityType: "Product" },
              select: { externalId: true, entityId: true },
            })
          ).map((sor) => [sor.externalId, sor.entityId]),
        ),
      ir: async ({ sourceProductId, fajta, celProductIdk }) =>
        prisma.$transaction(async (tx) => {
          /**
           * TOROL, MAJD UJRAIR -- ugyanaz a sorrend, amit a szinkron hasznal.
           *
           * A torles a SAJAT forrasunkra szukit (`source: "UNAS"`): egy kezzel
           * felvett kapcsolatot nem viszunk el.
           */
          await tx.productRelation.deleteMany({
            where: { sourceProductId, relationType: fajta, source: "UNAS" },
          });
          const created = await tx.productRelation.createMany({
            data: celProductIdk.map((targetProductId, index) => ({
              sourceProductId,
              targetProductId,
              relationType: fajta,
              sortOrder: index,
              source: "UNAS",
            })),
            skipDuplicates: true,
          });
          return created.count;
        }),
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
