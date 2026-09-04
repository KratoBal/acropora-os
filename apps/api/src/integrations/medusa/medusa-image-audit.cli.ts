import { pathToFileURL } from "node:url";

import type { CliOutput } from "./medusa-category.cli.js";
import {
  classifyImageAddress,
  type ImageAddressKind,
} from "./medusa-image-address.js";
import {
  MedusaImageLinkRepository,
  type MedusaImageLinkListing,
} from "./medusa-image-link.repository.js";

/**
 * HANY KEP-LEKEPEZES MUTAT KIVULROL ELERHETETLEN CIMRE.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api medusa:image-addresses
 *
 * === MIERT VAN, ES MIERT CSAK SZAMOL ===
 *
 * A tarolt bolti cim minden vetites-futasban ujra kimegy, tehat egy belso cim
 * nem gyogyul meg attol, hogy a beallitas kesobb helyre kerul. Ket ilyen
 * termeket ISMERUNK -- azt viszont nem tudjuk, hany sor all igy.
 *
 * A szam nem a javitas elokeszitese, hanem annak eldontese, MILYEN FAJTA
 * muvelet lesz belole: ket sor kezi javitas, ketszaz sor visszatoltes, es a
 * kettohoz mas engedely tartozik. Ez a parancs ezert OLVAS, es semmi mast --
 * nincs `--apply` alakja, mert nincs mit alkalmazni rajta.
 *
 * === AMIT A SZAM NEM MOND MEG ===
 *
 * Azt, hogy a tobbi kep ma betoltodik-e. Egy kivulrol ELERHETO alaku cim mogott
 * is allhat torolt fajl; azt csak egy lehivas mondana meg, es az mar mas meres.
 * A parancs ezt a hatart ki is irja, mert a szam kulonben tobbet allitana, mint
 * amennyit mertunk.
 */

export interface OriginCount {
  origin: string;
  kind: ImageAddressKind;
  rows: number;
}

export interface ImageAddressReport {
  /** Minden visszaolvashato lekepezes-sor. */
  rows: number;
  internalRows: number;
  publicRows: number;
  unreadableRows: number;
  /** A `toLink` altal vissza nem olvashato sorok: kulon szam, nem kivetel. */
  brokenRows: number;
  /** Hoszt szerinti bontas, csokkeno darabszam szerint. */
  origins: OriginCount[];
  /** A belso cimen allo kepek termek-azonositoi, egyszer-egyszer. */
  internalProductIds: string[];
}

/**
 * A BONTAS A SZAM MELLE, ES EZ NEM DISZ.
 *
 * Egy puszta darabszam elrejti a halmazt: ha a besorolo szabalyom szukebb a
 * valosagnal, a kimaradt sorok a `public` oldalon ulnek, es semmi nem szol. A
 * hoszt-bontasbol viszont latszik, ha egy nem vart hoszt sok sort visz -- azt
 * ember eszreveszi akkor is, ha a szabaly nem.
 */
export function auditImageAddresses(
  listing: MedusaImageLinkListing,
): ImageAddressReport {
  const szamlalo = new Map<string, OriginCount>();
  const termekek = new Set<string>();
  let internalRows = 0;
  let publicRows = 0;
  let unreadableRows = 0;

  for (const link of listing.links) {
    const verdict = classifyImageAddress(link.medusaUrl);
    if (verdict.kind === "internal") {
      internalRows += 1;
      termekek.add(link.productId);
    } else if (verdict.kind === "public") publicRows += 1;
    else unreadableRows += 1;

    const meglevo = szamlalo.get(verdict.origin);
    if (meglevo) meglevo.rows += 1;
    else
      szamlalo.set(verdict.origin, {
        origin: verdict.origin,
        kind: verdict.kind,
        rows: 1,
      });
  }

  return {
    rows: listing.links.length,
    internalRows,
    publicRows,
    unreadableRows,
    brokenRows: listing.broken.length,
    origins: [...szamlalo.values()].sort(
      (a, b) => b.rows - a.rows || a.origin.localeCompare(b.origin),
    ),
    internalProductIds: [...termekek].sort(),
  };
}

const KIND_NEVE: Record<ImageAddressKind, string> = {
  internal: "kívülről elérhetetlen",
  public: "kívülről elérhető alakú",
  unreadable: "olvashatatlan",
};

export function describeImageAddressReport(report: ImageAddressReport): string {
  const sorok = [
    `Leképezés-sorok: ${report.rows}`,
    `Ebből kívülről ELÉRHETETLEN címen: ${report.internalRows}`,
    `Kívülről elérhető alakú címen: ${report.publicRows}`,
    `Olvashatatlan cím: ${report.unreadableRows}`,
    `Vissza nem olvasható sor (hiányzó cím vagy kulcs): ${report.brokenRows}`,
    "",
    "Hoszt szerinti bontás:",
  ];

  for (const o of report.origins)
    sorok.push(`  ${o.origin} -- ${o.rows} sor (${KIND_NEVE[o.kind]})`);
  if (!report.origins.length) sorok.push("  (nincs egyetlen sor sem)");

  if (report.internalProductIds.length) {
    sorok.push(
      "",
      `Az érintett termékek (${report.internalProductIds.length} darab):`,
    );
    for (const id of report.internalProductIds) sorok.push(`  ${id}`);
  }

  /**
   * A HATAR A KIMENET RESZE, NEM A DOKUMENTACIOE. Aki a szamot tovabbadja, ezt
   * a mondatot is latja -- kulonben a szam ugy utazna tovabb, hogy a kepek
   * epsegerol allit valamit, holott csak a cimek alakjarol szol.
   */
  sorok.push(
    "",
    "AMIT EZ A SZÁM NEM MOND MEG: hogy a többi kép ma betöltődik-e. Egy",
    "kívülről elérhető ALAKÚ cím mögött is állhat törölt fájl -- azt csak egy",
    "lehívás mondaná meg. Ez a futás csak olvasott: semmit nem írt és nem törölt.",
  );
  return sorok.join("\n") + "\n";
}

export async function runImageAuditCli(
  _argv: readonly string[],
  out: CliOutput,
  deps: { listing(): Promise<MedusaImageLinkListing> },
): Promise<number> {
  const report = auditImageAddresses(await deps.listing());
  out.stdout(describeImageAddressReport(report));
  /**
   * A KILEPESI KOD 2, HA VAN BELSO CIM -- nem hiba, hanem "megnezendo".
   * Ugyanaz a megallapodas, mint a marka- es kategoria-parancs utkozeseinel: a
   * futas SIKERULT, tehat nem 1; a lelet viszont ember donteset varja, tehat
   * nem is 0.
   */
  return report.internalRows > 0 ? 2 : 0;
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runImageAuditCli`. */
async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  const repository = new MedusaImageLinkRepository();
  process.exitCode = await runImageAuditCli(process.argv.slice(2), out, {
    listing: () => repository.listAll(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
