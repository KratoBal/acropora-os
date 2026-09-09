import { pathToFileURL } from "node:url";

import { prisma, type MedusaImageBlockReason } from "@acropora/database";

import type { CliOutput } from "./medusa-category.cli.js";

/**
 * MIERT NEM MENTEK KI A KEPEK -- A LEGUTOBBI MEGALLAPITAS, OKONKENT.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api medusa:image-blocks
 *   pnpm --filter @acropora/api medusa:image-blocks --tetelesen
 *
 * === MIERT VAN ===
 *
 * A vetites minden termeknel eldonti, kimehet-e a kep-lista, es az okot a
 * termek soraba irja (`medusaImageBlockReason` es tarsai). Az adat MEGVAN --
 * olvaso felulet viszont nem letezik hozza: sem parancs, sem kepernyo. Egy ok,
 * amit senki nem tud megnezni, ugyanannyit er, mintha nem tarolnank.
 *
 * === EZ A PARANCS CSAK OLVAS ===
 *
 * Nincs `--apply` alakja, es nem is lehet: nincs mit alkalmazni rajta. A
 * blokk-okot a vetites irja, es csak egy KOVETKEZO vetites irhatja felul.
 *
 * === A HATAR, AMI A KIMENETBE IS BELE VAN IRVA ===
 *
 * A `medusaImageBlockedAt` azt mondja meg, MIKOR ALLAPITOTTUK MEG -- nem azt,
 * hogy MA IS all-e. Ha egy kep azota atkerult a mesterbe, a mezo attol meg ott
 * marad a regi okkal, amig egy uj vetites felul nem irja. Ez a parancs tehat a
 * LEGUTOBBI MEGALLAPITAST adja vissza, nem a jelen allapotot.
 */

/** Egy termek sora, csak a negy mezovel, amit ez a parancs olvas. */
export interface ImageBlockRow {
  id: string;
  name: string;
  reason: MedusaImageBlockReason;
  details: string | null;
  blockedAt: Date | null;
}

export interface ReasonCount {
  reason: MedusaImageBlockReason;
  rows: number;
  /** A legfrissebb megallapitas ezen az okon; `null`, ha egyik soron sincs. */
  latest: Date | null;
}

export interface ImageBlockReport {
  rows: number;
  byReason: ReasonCount[];
  /** A legfrissebb megallapitas barmelyik okon. */
  latest: Date | null;
  /**
   * A MUKODESI blokkok szama: minden, ami NEM `NO_IMAGE_ROW`.
   *
   * A megkulonboztetes nem szorszalhasogatas: a `NO_IMAGE_ROW` azt jelenti,
   * hogy nincs mit kikuldeni, es az nem hiba. Ha ezt egy szamba olvasztanank a
   * tobbivel, egy tokeletesen egeszseges katalogus is riasztast adna.
   */
  actionable: number;
  /**
   * VOLT-E OLYAN SOR, AMI `NO_IMAGE_ROW`.
   *
   * Ez a "lefutott-e egyaltalan" jelzoje, es a NULLA ertelmezesehez kell.
   * A `NO_IMAGE_ROW` okot ugyanis CSAK a vetites tudja beirni -- ha van ilyen
   * sor, akkor a kep-lepes biztosan lefutott legalabb egyszer.
   */
  sawNoImageRow: boolean;
}

/**
 * A TISZTA FUGGVENY, adatbazis nelkul merheto -- ugyanaz a szerkezet, mint a
 * testverparancsnal (`medusa-image-audit.cli.ts`).
 */
export function auditImageBlocks(
  rows: readonly ImageBlockRow[],
): ImageBlockReport {
  const szamlalo = new Map<MedusaImageBlockReason, ReasonCount>();
  let latest: Date | null = null;
  let actionable = 0;
  let sawNoImageRow = false;

  for (const row of rows) {
    if (row.reason === "NO_IMAGE_ROW") sawNoImageRow = true;
    else actionable += 1;

    if (row.blockedAt && (!latest || row.blockedAt > latest))
      latest = row.blockedAt;

    const meglevo = szamlalo.get(row.reason);
    if (meglevo) {
      meglevo.rows += 1;
      if (row.blockedAt && (!meglevo.latest || row.blockedAt > meglevo.latest))
        meglevo.latest = row.blockedAt;
    } else
      szamlalo.set(row.reason, {
        reason: row.reason,
        rows: 1,
        latest: row.blockedAt,
      });
  }

  return {
    rows: rows.length,
    byReason: [...szamlalo.values()].sort(
      (a, b) => b.rows - a.rows || a.reason.localeCompare(b.reason),
    ),
    latest,
    actionable,
    sawNoImageRow,
  };
}

const OK_MONDATA: Record<MedusaImageBlockReason, string> = {
  NO_IMAGE_ROW: "nincs kép-sor a forrásban (nem hiba)",
  MASTER_MISSING: "a kép még nincs áthozva a mesterbe -- a másoló dolga",
  MASTER_CORRUPT:
    "a tároló-kulcs áll, de a fájl nincs meg -- a mestert kell javítani",
  NOT_AN_IMAGE: "a bájtok nem ismerhetők fel képként",
  UPLOAD_FAILED: "a feltöltés elhasalt: a bolt vagy a hálózat",
};

function idopont(value: Date | null): string {
  return value ? value.toISOString() : "nincs időbélyeg";
}

export function describeImageBlockReport(
  report: ImageBlockReport,
  tetelesen: readonly ImageBlockRow[] | null,
): string {
  const sorok = [
    `Kép-blokkal álló termékek: ${report.rows}`,
    `Ebből TEENDŐT igénylő (nem "nincs kép-sor"): ${report.actionable}`,
    `A legfrissebb megállapítás: ${idopont(report.latest)}`,
    "",
    "Ok szerinti bontás:",
  ];

  for (const o of report.byReason)
    sorok.push(
      `  ${o.reason} -- ${o.rows} termék, legfrissebb: ${idopont(o.latest)}`,
      `      ${OK_MONDATA[o.reason]}`,
    );
  if (!report.byReason.length)
    sorok.push("  (egyetlen termék sem áll blokkal)");

  /**
   * A NULLA KET ALLAPOTOT JELENTHET, ES A KETTO TEENDOJE ELLENTETES. Ezert all
   * a mondat a KIMENETBEN, nem a dokumentacioban: aki a szamot tovabbadja, ezt
   * is latja.
   */
  if (report.rows === 0)
    sorok.push(
      "",
      "A NULLA KÉT KÜLÖNBÖZŐ ÁLLAPOTOT JELENTHET, és a lekérdezés nem",
      "választja szét őket: siker esetén a vetítés MIND A HÁROM mezőt nullázza,",
      "tehát ugyanaz a kép marad, mintha a kép-lépés soha nem futott volna le.",
      "  a) minden kép kiment, és a vetítés nullázta az okokat",
      "  b) a vetítés el sem jutott a kép-lépésig (vagy sosem futott)",
      "AMI SZÉTVÁLASZTJA: ha valaha lefutott, a kép NÉLKÜLI termékek",
      '"NO_IMAGE_ROW" okot kapnak. Ez a futásban egyetlen ilyen sor sem áll,',
      "tehát a (b) eset nem zárható ki innen -- a vetítés naplója mondja meg.",
    );
  else if (!report.sawNoImageRow)
    sorok.push(
      "",
      'EGYETLEN "NO_IMAGE_ROW" sor sincs. Ez önmagában nem hiba (lehet, hogy',
      "minden feldolgozott terméknek van kép-sora), de azt jelenti, hogy ebből",
      "a számból nem következtethetünk arra, hány terméket járt be a vetítés.",
    );

  if (tetelesen) {
    sorok.push("", `Tételesen (${tetelesen.length} termék):`);
    for (const row of tetelesen)
      sorok.push(
        `  ${row.id}  ${row.name}`,
        `      ${row.reason} -- ${row.details ?? "(nincs részletező mondat)"}`,
        `      megállapítva: ${idopont(row.blockedAt)}`,
      );
  } else if (report.rows > 0)
    sorok.push("", "A részletező mondatokhoz: --tetelesen");

  /**
   * A HATAR A KIMENET RESZE, NEM A DOKUMENTACIOE -- ugyanaz az indok, mint a
   * testverparancsnal: aki a szamot tovabbadja, ezt a mondatot is latja.
   */
  sorok.push(
    "",
    "AMIT EZ NEM MOND MEG: hogy az ok MA IS áll-e. A mező a LEGUTOBBI",
    "megállapítást őrzi; ha egy kép azóta átkerült a mesterbe, az ok akkor is",
    "ott marad, amíg egy új vetítés felül nem írja. Ez a futás csak olvasott:",
    "semmit nem írt és nem törölt.",
  );
  return sorok.join("\n") + "\n";
}

export async function runImageBlockAuditCli(
  argv: readonly string[],
  out: CliOutput,
  deps: { rows(): Promise<ImageBlockRow[]> },
): Promise<number> {
  const rows = await deps.rows();
  const report = auditImageBlocks(rows);
  out.stdout(
    describeImageBlockReport(
      report,
      argv.includes("--tetelesen") ? rows : null,
    ),
  );
  /**
   * A KILEPESI KOD 2, HA VAN TEENDOT IGENYLO BLOKK -- nem hiba, hanem
   * "megnezendo". Ugyanaz a megallapodas, mint a testverparancsoknal.
   *
   * A `NO_IMAGE_ROW` NEM szamit bele: az nem hiba, es egy katalogus, amiben
   * van kep nelkuli termek, nem "megnezendo" allapot.
   */
  return report.actionable > 0 ? 2 : 0;
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runImageBlockAuditCli`. */
async function blokkoltTermekek(): Promise<ImageBlockRow[]> {
  const rows = await prisma.product.findMany({
    where: { medusaImageBlockReason: { not: null } },
    select: {
      id: true,
      name: true,
      medusaImageBlockReason: true,
      medusaImageBlockDetails: true,
      medusaImageBlockedAt: true,
    },
    orderBy: [{ medusaImageBlockedAt: "desc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    reason: row.medusaImageBlockReason!,
    details: row.medusaImageBlockDetails,
    blockedAt: row.medusaImageBlockedAt,
  }));
}

async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runImageBlockAuditCli(process.argv.slice(2), out, {
    rows: blokkoltTermekek,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
