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

/**
 * EGY TERMEK, AHOGY A PARANCS LATJA.
 *
 * A `externalId` LEHET `null`, es ez nem elovigyazatossag: a kulso azonosito NEM
 * a pillanatkepen all, hanem az `ExternalReference` tablan. Egy pillanatkep,
 * amihez nincs hivatkozas-sor, nem kihagyhato CSENDBEN -- az a termek
 * onhivatkozaskent sem lenne felismerheto, tehat a sajat kapcsolatai kozott
 * megjelenhetne.
 */
export interface UjraepitesJelolt {
  productId: string;
  externalId: string | null;
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
  /**
   * A MAR MEGLEVO UNAS-KAPCSOLATOK DARABSZAMA, termekenkent es fajtankent.
   *
   * MIERT KELL, ES MIERT EGY LEKERDEZESSEL: a terv-ag nem hivja az irast, tehat
   * kulonben NEM TUDNA megmondani, hany sor tunne el. A legfontosabb hatas
   * maradna lathatatlan: a futas utan senki nem tudna, fogytak-e a kapcsolatok.
   *
   * Termekenkenti lekerdezes ketezer termeknel negyezer kort jelentene; ez
   * EGY osszesites, a hivo pedig terkepbol olvas.
   */
  meglevoKapcsolatok(): Promise<Map<string, number>>;
  /**
   * A TENYLEGES IRAS. CSAK `--apply` mellett hivodik.
   *
   * URES `celProductIdk` MELLETT IS HIVJUK, es az nem ures muvelet: olyankor a
   * TORLES tortenik meg, ujrairas nelkul -- ez a forrasbol eltunt kapcsolatok
   * esete. Ezert ad vissza KET szamot: ami eltunt, es ami a helyere kerult.
   */
  ir(input: {
    sourceProductId: string;
    fajta: KapcsolatFajta;
    celProductIdk: readonly string[];
  }): Promise<{ torolt: number; irt: number }>;
}

/** A terkep kulcsa: egy termek egy kapcsolat-fajtaja. */
export function meglevoKulcs(productId: string, fajta: KapcsolatFajta): string {
  return `${productId}|${fajta}`;
}

export interface UjraepitesSzamok {
  termek: number;
  hivatkozastVisel: number;
  /**
   * HANY TERMEK KAP TENYLEGESEN KAPCSOLATOT -- ES EZ NEM A `hivatkozastVisel`.
   *
   * A ketto MAS HALMAZ: aminek a hivatkozasai kozul EGY SEM oldodik fel, az
   * visel hivatkozast, de nem kap kapcsolatot. Egy kozos mondat ("120 kapcsolat
   * 60 termeken") ugy olvasodna, mintha mind a hatvan kapott volna.
   */
  kapcsolatotKapott: number;
  irhatoKapcsolat: number;
  feloldatlan: number;
  onhivatkozas: number;
  duplikatum: number;
  azonositoNelkul: number;
  /**
   * HANY SOR TUNIK EL, mert a forrasban mar nincs kapcsolat.
   *
   * A terv-agon is szamolodik (a meglevo sorok terkepebol), kulonben a futas
   * legfontosabb hatasa lathatatlan maradna: utana senki nem tudna megmondani,
   * hogy a kapcsolatok fogytak-e, es hol.
   */
  eltavolitott: number;
  /** Hany termeken TORTENT eltavolitas -- a sorok szama melle a hely. */
  eltavolitottTermek: number;
  /**
   * HANY PILLANATKEP NEM VOLT OLVASHATO. Ezeken NEM torlunk: a nem-olvashato
   * nem azt mondja, hogy nincs kapcsolat, hanem hogy nem tudjuk.
   */
  olvashatatlan: number;
  /**
   * HANY TERMEKNEL VAN HIVATKOZAS, DE EGYIK SEM OLDODIK FEL. Ezeken SEM torlunk,
   * es itt SZANDEKOSAN elterunk a szinkrontol: az ilyenkor is torol, mielott
   * ujrair. A feloldatlan hivatkozas a TERKEP hibajanak a jele (a celpont nincs
   * a katalogusunkban), es ilyenkor a meglevo sorok elvitele a rosszabb tevedes:
   * egy hibas terkep miatt veszitenenk el olyan kapcsolatot, ami helyes.
   */
  csakFeloldatlan: number;
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
    const [jeloltek, terkep, meglevo] = await Promise.all([
      deps.jeloltek(),
      deps.terkep(),
      deps.meglevoKapcsolatok(),
    ]);

    const szamok: Record<KapcsolatFajta, UjraepitesSzamok> = {
      SIMILAR: uresSzamok(),
      ACCESSORY: uresSzamok(),
    };
    const minta: Record<KapcsolatFajta, string[]> = {
      SIMILAR: [],
      ACCESSORY: [],
    };

    let kulsoAzonositoNelkul = 0;
    for (const jelolt of jeloltek) {
      /**
       * KULSO AZONOSITO NELKUL NEM DOLGOZUNK FEL -- ES NEM CSENDBEN.
       *
       * A feloldas SAJAT azonositoval szamol: az onhivatkozast abbol ismeri fel
       * (`reference.externalId === sourceExternalId`). Enelkul egy termek a
       * SAJAT kapcsolatai koze kerulhetne.
       *
       * A szam a fejlecben all, nem fajtankent: ez a termek tulajdonsaga, nem a
       * kapcsolate.
       */
      if (jelolt.externalId === null) {
        kulsoAzonositoNelkul += 1;
        continue;
      }
      for (const fajta of FAJTAK) {
        const szam = szamok[fajta];
        szam.termek += 1;
        const olvasas = kapcsolatHivatkozasok(jelolt.rawPayload, fajta);
        szam.azonositoNelkul += olvasas.azonositoNelkul;

        if (olvasas.hivatkozasok.length === 0) {
          /**
           * A FORRASBAN NINCS KAPCSOLAT -- DE CSAK AKKOR TORLUNK, HA EZT TUDJUK IS.
           *
           * EZ AZ AG A PARANCS LEGFONTOSABB RESZE, es az elso valtozatbol
           * HIANYZOTT. Az indok, amit odairtam ("nincs mit torolni-ujrairni"),
           * EGY esetben hamis, es epp abban, amiert a parancs letezik: ha egy
           * termek 2026-09-05-en kapott kapcsolatokat (akkor valtozott, tehat a
           * szinkron irt ra), es azota a forrasban KIVETTEK oket, a regi sorok
           * bent maradnak.
           *
           * ES NINCS MAS UT, AMIN ELTUNNENEK: a diff motor hat mezot vet ossze
           * (cim, marka, kategoria, kepek, csatorna-lista, aktiv allapot), es a
           * KAPCSOLAT NINCS KOZTUK. Egy termek, amiben CSAK a kapcsolatok
           * valtoztak, UNCHANGED marad -- a szinkron soha nem ir ra.
           * (acrobot merese, 2026-09-17.)
           */
          if (!olvasas.olvashato) {
            szam.olvashatatlan += 1;
            continue;
          }
          const meglevoDb = meglevo.get(meglevoKulcs(jelolt.productId, fajta));
          if (!meglevoDb) continue;
          if (apply) {
            const eredmeny = await deps.ir({
              sourceProductId: jelolt.productId,
              fajta,
              celProductIdk: [],
            });
            szam.eltavolitott += eredmeny.torolt;
          } else szam.eltavolitott += meglevoDb;
          szam.eltavolitottTermek += 1;
          continue;
        }
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

        if (mapping.targets.length === 0) {
          /*
            VAN HIVATKOZAS, DE EGYIK SEM OLDODIK FEL -- ES ITT NEM TORLUNK.
            A szinkron ilyenkor is torol (a torlese a hataron KIVUL all), es
            ezen a ponton SZANDEKOSAN elterek tole: a feloldatlan hivatkozas a
            TERKEP hibajanak a jele, nem a forrasenak. Egy hibas terkep miatt
            elvinni a meglevo, helyes sorokat rosszabb tevedes, mint megtartani
            oket egy korrel tovabb.
          */
          szam.csakFeloldatlan += 1;
          continue;
        }
        szam.kapcsolatotKapott += 1;
        if (apply) {
          const eredmeny = await deps.ir({
            sourceProductId: jelolt.productId,
            fajta,
            celProductIdk: mapping.targets.map((cel) => cel.productId),
          });
          szam.irhatoKapcsolat += eredmeny.irt;
        } else szam.irhatoKapcsolat += mapping.targets.length;
      }
    }

    out.stdout(
      `${apply ? "Megírva" : "Terv"}: ${jeloltek.length} termék, ` +
        `${terkep.size} külső azonosító a térképen; ` +
        `külső azonosító nélkül kihagyva ${kulsoAzonositoNelkul}.\n`,
    );
    for (const fajta of FAJTAK) {
      const szam = szamok[fajta];
      /*
        MINDEN SZAM MEGNEVEZVE, ES A KET TERMEK-SZAM KULON.
        Az elso alak `${irhatoKapcsolat} kapcsolat ${hivatkozastVisel} termeken`
        volt, es az ket KULONBOZO halmazt tett egy mondatba: aminek egyetlen
        hivatkozasa sem oldodik fel, az visel hivatkozast, de nem kap kapcsolatot.
        Sok feloldatlannal a mondat ugy olvasodott, mintha mind kapott volna.
      */
      out.stdout(
        `  ${fajta}: hivatkozást visel ${szam.hivatkozastVisel} termék, ` +
          `ebből ${szam.kapcsolatotKapott} kap kapcsolatot ` +
          `(${szam.irhatoKapcsolat} sor); feloldatlan ${szam.feloldatlan}, ` +
          `önhivatkozás ${szam.onhivatkozas}, duplikátum ${szam.duplikatum}, ` +
          `azonosító nélkül ${szam.azonositoNelkul}.\n`,
      );
      out.stdout(
        `    ${apply ? "eltávolított" : "eltávolítandó"} ${szam.eltavolitott} sor ` +
          `${szam.eltavolitottTermek} terméken (a forrásban már nincs kapcsolat); ` +
          `olvashatatlan pillanatkép ${szam.olvashatatlan}, ` +
          `csak feloldatlan hivatkozás ${szam.csakFeloldatlan} terméken -- ` +
          `ezeken NEM törlünk.\n`,
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
    kapcsolatotKapott: 0,
    irhatoKapcsolat: 0,
    feloldatlan: 0,
    onhivatkozas: 0,
    duplikatum: 0,
    azonositoNelkul: 0,
    eltavolitott: 0,
    eltavolitottTermek: 0,
    olvashatatlan: 0,
    csakFeloldatlan: 0,
  };
}

/**
 * A UNAS KULSO AZONOSITOI, EGYSZER LEKERDEZVE.
 *
 * Ket varrat hasznalja (a jeloltek sajat azonositoja es a feloldas terkepe), es
 * a ket hivas ugyanabban a korben all -- egy masodik lekerdezes ugyanazt a
 * nehany ezer sort hozna le megegyszer.
 */
let kulsoSorokGyorsitotar:
  Promise<Array<{ externalId: string; entityId: string }>> | undefined;
function kulsoAzonositoSorok() {
  return (kulsoSorokGyorsitotar ??= prisma.externalReference.findMany({
    where: { system: "UNAS", entityType: "Product" },
    select: { externalId: true, entityId: true },
  }));
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
      /**
       * A KULSO AZONOSITO NEM A PILLANATKEPEN ALL.
       *
       * Az elso valtozat `externalId`-t kert a `UnasProductSnapshot` modelltol,
       * es a parancs EL SEM INDULT: `Unknown field externalId for select
       * statement`. A modellen `productId` all (unique); a kulso azonosito az
       * `ExternalReference` tablan lakik -- pontosan ott, ahonnan a terkep is
       * olvas.
       *
       * EZERT EGY LEKERDEZES SZOLGALJA MIND A KETTOT: a sorokbol elore-terkep
       * lesz a feloldashoz, es FORDITOTT terkep a jeloltek sajat azonositojahoz.
       */
      jeloltek: async () => {
        const [pillanatkepek, kulsoSorok] = await Promise.all([
          prisma.unasProductSnapshot.findMany({
            select: { productId: true, rawPayload: true },
          }),
          kulsoAzonositoSorok(),
        ]);
        const forditott = new Map(
          kulsoSorok.map((sor) => [sor.entityId, sor.externalId]),
        );
        return pillanatkepek.map((sor) => ({
          productId: sor.productId,
          externalId: forditott.get(sor.productId) ?? null,
          rawPayload: sor.rawPayload,
        }));
      },
      terkep: async () =>
        new Map(
          (await kulsoAzonositoSorok()).map((sor) => [
            sor.externalId,
            sor.entityId,
          ]),
        ),
      /*
        EGY OSSZESITES, NEM TERMEKENKENTI LEKERDEZES: ketezer termeknel a
        masodik alak negyezer kort jelentene, es a parancs epp azert letezik,
        hogy EGYSZER fusson le.
      */
      meglevoKapcsolatok: async () =>
        new Map(
          (
            await prisma.productRelation.groupBy({
              by: ["sourceProductId", "relationType"],
              where: { source: "UNAS" },
              _count: { _all: true },
            })
          ).map((sor) => [
            meglevoKulcs(
              sor.sourceProductId,
              sor.relationType as KapcsolatFajta,
            ),
            sor._count._all,
          ]),
        ),
      ir: async ({ sourceProductId, fajta, celProductIdk }) =>
        prisma.$transaction(async (tx) => {
          /**
           * TOROL, MAJD UJRAIR -- ugyanaz a sorrend, amit a szinkron hasznal.
           *
           * A torles a SAJAT forrasunkra szukit (`source: "UNAS"`): egy kezzel
           * felvett kapcsolatot nem viszunk el.
           */
          const torolt = await tx.productRelation.deleteMany({
            where: { sourceProductId, relationType: fajta, source: "UNAS" },
          });
          if (celProductIdk.length === 0)
            return { torolt: torolt.count, irt: 0 };
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
          return { torolt: torolt.count, irt: created.count };
        }),
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
