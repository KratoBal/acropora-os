/**
 * THE RENTAL CONTRACT TEMPLATE (task eszkozberles, S3; Balázs, 2026-11-06: "a szöveg cserélhető legyen, ne beégetett").
 *
 * The text lives in the database (Settings > Bérleti szerződés) and has `{{valtozo}}` places; the API fills them from the
 * rental when it prints. One list of variables, here, so the editor, the save check and the renderer agree on it.
 *
 * The markup is deliberately small: a line starting with `## ` is a heading, a line that is exactly `[[alairas]]` is the
 * two signature lines (Bérbeadó, Bérlő), an empty line ends a paragraph, a single line break stays a line break. Nothing else
 * is interpreted.
 */
export const RENTAL_CONTRACT_VARIABLES = {
  szerzodes_szam: "A bérlés (szerződés) száma",
  ceg_nev: "A bérbeadó neve",
  ceg_szekhely: "A bérbeadó székhelye",
  berlo_nev: "A bérlő neve",
  berlo_cim: "A bérlő címe",
  berlo_telefon: "A bérlő telefonszáma",
  berlo_email: "A bérlő e-mail címe",
  eszkoz_nev: "Az eszköz neve",
  eszkoz_gyari_szam: "Az eszköz gyári száma",
  eszkoz_tartozekok: "Az átadott tartozékok",
  atadaskori_megjegyzes: "A bérléshez írt megjegyzés",
  berles_kezdete: "A bérlés kezdete (dátum, óra, perc)",
  tervezett_visszahozas: "A tervezett visszahozás (dátum, óra, perc)",
  napi_dij: "A napi bérleti díj, Ft-tal",
  varhato_dij: "A várható bérleti díj a tervezett időre, Ft-tal",
  kaucio: "A kaució, Ft-tal",
  potlasi_ertek: "Az eszköz pótlási értéke, Ft-tal",
  kesedelmi_szorzo: "A késedelmi szorzó (a bérléskor érvényes beállítás)",
  kesedelem_napok:
    "Hány nap késés után jár a pótlási érték (a bérléskor érvényes beállítás)",
  kelt_datum: "A szerződés kelte: a bérlés kezdőnapja",
} as const;

export type RentalContractVariable = keyof typeof RENTAL_CONTRACT_VARIABLES;
export type RentalContractValues = Record<RentalContractVariable, string>;

/** What the contract prints where a setting is still missing: visible, so nobody signs a number nobody decided. */
export const RENTAL_CONTRACT_MISSING_VALUE = "[még nincs megadva]";

export const RENTAL_CONTRACT_LIMITS = {
  template: { min: 1, max: 50_000 },
  lateFeeMultiplier: { min: 1, max: 10 },
  replacementAfterDays: { min: 1, max: 365 },
} as const;

export interface RentalSettings {
  contractTemplate: string;
  /** `true` while no one has saved a template: the text is the built-in starting point. */
  contractTemplateIsDefault: boolean;
  /** The daily fee times this, per started late day. `null` until Balázs decides (acrobot 44187). */
  lateFeeMultiplier: number | null;
  /** After this many late days the full replacement value may be claimed. `null` until Balázs decides. */
  replacementAfterDays: number | null;
}

const PLACE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The `{{...}}` places in a template that are not on the list, each once, in order of appearance. */
export function unknownRentalContractVariables(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(PLACE)) {
    const name = match[1] ?? "";
    // own keys only: `in` also sees the prototype ({{constructor}}, {{toString}}, {{__proto__}}; barracuda, #2360)
    if (!Object.hasOwn(RENTAL_CONTRACT_VARIABLES, name)) unknown.add(name);
  }
  return [...unknown];
}

/** Fills every known place; an unknown one stays as written, so a typo is visible on paper instead of silently empty. */
export function fillRentalContractTemplate(
  template: string,
  values: RentalContractValues,
): string {
  return template.replace(PLACE, (whole, name: string) =>
    Object.hasOwn(values, name)
      ? values[name as RentalContractVariable]
      : whole,
  );
}

export type RentalContractBlock =
  | { kind: "heading"; text: string }
  | { kind: "signatures" }
  | { kind: "paragraph"; lines: string[] };

/** The filled text as blocks: `## ` headings, paragraphs split on empty lines, line breaks kept inside a paragraph. */
export function rentalContractBlocks(text: string): RentalContractBlock[] {
  const blocks: RentalContractBlock[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length > 0) blocks.push({ kind: "paragraph", lines });
    lines = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") flush();
    else if (line.trim() === "[[alairas]]") {
      flush();
      blocks.push({ kind: "signatures" });
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
    } else lines.push(line);
  }
  flush();
  return blocks;
}
