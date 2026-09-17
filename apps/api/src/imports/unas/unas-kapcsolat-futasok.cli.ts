import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

/**
 * A KAPCSOLAT-UJRAEPITES FUTASAI, OLVASVA.
 *
 * === MIERT LETEZIK (acrobot kerese, 2026-09-17) ===
 *
 * A `UnasRelationRebuildRun` tabla a #804-gyel keszult el, es azota van iroja
 * (a parancs) es olvasoja is (a napi utemezo, ami az utolso futas kezdetet
 * kerdezi). AMI HIANYZOTT: egy alak, amivel EMBER is megnezheti, mi tortent.
 *
 * Ez nem kenyelmi kerdes. Az utemezo elso bekapcsolasa IRAS NELKUL tortenik: egy
 * napig tervet keszit, es a szamokat feljegyzi. Abbol szamoljuk ki, mekkora a
 * napi elsodras -- de csak akkor, ha a sorokat ki lehet olvasni.
 *
 * ES A TABLAT NEM EN OLVASOM: a stage adatbazishoz acrobotnak van eleres, nekem
 * nincs. Egy hianyzo parancs viszont NEM jogosultsagi kerdes -- azt meg lehet
 * irni. (A sajat lapunk kilencedik korlat-fajtaja: az adat megvan, a parancs
 * nincs.)
 *
 * CSAK OLVAS. Nincs `--apply`, nincs iras, nincs kapcsolo, ami irna.
 */

export interface FutasSor {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  applied: boolean;
  stopped: boolean;
  errorCode: string | null;
  rowsBefore: number;
  rowsPlanned: number;
  similarRelationsPlanned: number;
  similarRelationsWritten: number;
  similarRelationsRemoved: number;
  similarReferencesUnresolved: number;
  accessoryRelationsPlanned: number;
  accessoryRelationsWritten: number;
  accessoryRelationsRemoved: number;
  accessoryReferencesUnresolved: number;
  unreadableSnapshots: number;
  withoutExternalId: number;
}

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface FutasokDeps {
  futasok(limit: number): Promise<FutasSor[]>;
  /**
   * AZ UTEMEZO KAPCSOLOJA -- MERT AZ URES EREDMENY LEGGYAKORIBB OKA EZ.
   *
   * Merve 2026-09-17 23:14 (acrobot, mind a ket kornyezeten): a tabla LETEZIK
   * es URES, es nem azert, mert a csendes ora meg nem jott el, hanem mert az
   * `UNAS_RELATION_REBUILD_SCHEDULE_ENABLED` valtozo SEHOL nem all. Ot bement
   * PR keszult el ugy, hogy egyik sem futott meg soha.
   *
   * O ezt kezzel nyomozta ki, konteneren belul. Egy ures lista magatol nem
   * mondja meg, hogy "meg korai" vagy hogy "nincs felhuzva" -- pedig a ketto
   * teljesen mas teendo.
   */
  utemezoBekapcsolva(): boolean;
}

/** Alapertelmezett darabszam. Egy napi futasnal ez ket hetnyi tortenet. */
const ALAP_LIMIT = 14;

/**
 * A FUTAS ALLAPOTA EGY SZOBAN -- ES A NEGY ESET KULON ALL.
 *
 * A `stopped` es a `applied` egyutt olvasva felrevezeto lenne: egy megallt
 * futas `applied: false`, tehat ugyanugy nez ki, mint egy terv. A kulonbseget a
 * `stopped` mondja meg, es ezert kap SAJAT szot.
 */
function allapot(sor: FutasSor): string {
  if (sor.errorCode) return `HIBA (${sor.errorCode})`;
  if (sor.stopped) return "MEGALLT a nagy változás határán";
  return sor.applied ? "ÍRT" : "tervet készített";
}

/** Helyi ido, masodperc pontossaggal. A telepites zonaja Europe/Budapest. */
function ido(ertek: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${ertek.getFullYear()}-${p(ertek.getMonth() + 1)}-${p(ertek.getDate())} ` +
    `${p(ertek.getHours())}:${p(ertek.getMinutes())}:${p(ertek.getSeconds())}`
  );
}

export async function runKapcsolatFutasokCli(
  argv: readonly string[],
  out: CliOutput,
  deps: FutasokDeps,
): Promise<number> {
  const limitIndex = argv.indexOf("--limit");
  const limit =
    limitIndex === -1 ? ALAP_LIMIT : Number(argv[limitIndex + 1] ?? ALAP_LIMIT);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    out.stderr("A --limit egy 1 és 500 közötti egész szám.\n");
    return 1;
  }

  try {
    const sorok = await deps.futasok(limit);
    /*
      AZ URES EREDMENY IS VALASZ, ES KI KELL MONDANI. Egy ures kimenet
      megkulonboztethetetlen attol, mintha a parancs el sem indult volna -- es
      epp ez a tabla arra valo, hogy a "nem tortent semmi" is latszodjon.
    */
    if (sorok.length === 0) {
      out.stdout(
        "Egyetlen futás sincs feljegyezve. Ez vagy azt jelenti, hogy a " +
          "parancs még sosem futott ezen az adatbázison, vagy hogy rossz " +
          "adatbázisra néztünk.\n",
      );
      /*
        ES A HARMADIK OK, AMI A LEGGYAKORIBB -- ES AMIT EDDIG KEZZEL KELLETT
        KINYOMOZNI. Egy ures lista magatol nem valaszt el ket teljesen kulonbozo
        allapotot: "meg korai" (be van kapcsolva, de a csendes ora meg nem jott
        el) es "nincs felhuzva" (a kapcsolo sehol nem all). A teendo ellentetes:
        az elsonel VARNI kell, a masodiknal DONTENI.
      */
      out.stdout(
        deps.utemezoBekapcsolva()
          ? "Az ütemező BE VAN KAPCSOLVA ebben a környezetben, tehát a " +
              "csendes ablak még nem jött el, vagy a folyamat nem futott " +
              "azóta. Várni kell rá.\n"
          : "AZ ÜTEMEZŐ NINCS BEKAPCSOLVA ebben a környezetben " +
              "(UNAS_RELATION_REBUILD_SCHEDULE_ENABLED). Nem késik: fel sem " +
              "húztuk. Ez nem várakozás kérdése, hanem döntésé.\n",
      );
      return 0;
    }

    for (const sor of sorok) {
      const valtozas = sor.rowsPlanned - sor.rowsBefore;
      const elojel = valtozas > 0 ? "+" : "";
      out.stdout(
        `${ido(sor.startedAt)}  ${allapot(sor)}\n` +
          `  sorok: ${sor.rowsBefore} -> ${sor.rowsPlanned} ` +
          `(${elojel}${valtozas})\n` +
          `  hasonló:    terv ${sor.similarRelationsPlanned}, ` +
          `írt ${sor.similarRelationsWritten}, ` +
          `eltávolított ${sor.similarRelationsRemoved}, ` +
          `feloldatlan ${sor.similarReferencesUnresolved}\n` +
          `  kiegészítő: terv ${sor.accessoryRelationsPlanned}, ` +
          `írt ${sor.accessoryRelationsWritten}, ` +
          `eltávolított ${sor.accessoryRelationsRemoved}, ` +
          `feloldatlan ${sor.accessoryReferencesUnresolved}\n` +
          `  nem dolgoztunk rajta: ${sor.unreadableSnapshots} olvashatatlan ` +
          `pillanatkép, ${sor.withoutExternalId} külső azonosító nélkül\n`,
      );
    }

    /*
      A NAPI ELSODRAS A TERV-FUTASOKBOL SZAMOLHATO, ES CSAK AZOKBOL. Egy IRO
      futas utan a kovetkezo mar a sajat eredmenyet latja kiindulasnak, tehat a
      valtozasa nem az elsodrast meri. Ezert szuruk.
    */
    const tervek = sorok.filter((sor) => !sor.applied && !sor.errorCode);
    if (tervek.length > 0) {
      const valtozasok = tervek.map((sor) => sor.rowsPlanned - sor.rowsBefore);
      const osszeg = valtozasok.reduce((a, b) => a + b, 0);
      out.stdout(
        `\n${tervek.length} terv-futás alapján a változás átlaga ` +
          `${Math.round(osszeg / tervek.length)} sor, ` +
          `a legnagyobb ${Math.max(...valtozasok.map(Math.abs))}.\n` +
          "(Csak a terv-futásokat számolom: egy író futás után a következő már " +
          "a saját eredményét látja kiindulásnak.)\n",
      );
    }
    return 0;
  } catch (error) {
    out.stderr(`A futások lekérdezése elhasalt: ${String(error)}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runKapcsolatFutasokCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      utemezoBekapcsolva: () =>
        process.env.UNAS_RELATION_REBUILD_SCHEDULE_ENABLED === "true",
      futasok: (limit) =>
        prisma.unasRelationRebuildRun.findMany({
          orderBy: { startedAt: "desc" },
          take: limit,
          select: {
            id: true,
            startedAt: true,
            completedAt: true,
            applied: true,
            stopped: true,
            errorCode: true,
            rowsBefore: true,
            rowsPlanned: true,
            similarRelationsPlanned: true,
            similarRelationsWritten: true,
            similarRelationsRemoved: true,
            similarReferencesUnresolved: true,
            accessoryRelationsPlanned: true,
            accessoryRelationsWritten: true,
            accessoryRelationsRemoved: true,
            accessoryReferencesUnresolved: true,
            unreadableSnapshots: true,
            withoutExternalId: true,
          },
        }),
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
