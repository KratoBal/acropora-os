/**
 * A V0 KIERTEKELES: ARANY KESZLET BEOLVASASA ES A G PONT MEROSZAMAI.
 *
 * Szerzodes: #1199 ACD-003 Q-004 F es G (acrobot javaslata), ACD-004 P-007,
 * PD-002 ACCEPT. A kuszobok a G pont tablazatabol jonnek; a TECHNIKAI
 * kuszobok itt allnak, a PRODUCT-dontesek (0,9 alatti javaslat megjelenitese,
 * a 40% megeri-e, rejtett kontroll) nem ennek a kodnak a dolga.
 */

export const NONE_KEY = "NONE";

/** A G pont technikai kuszobei (ACD-003 Q-004 G). */
export const GO_THRESHOLDS = {
  confidence: 0.9,
  accuracyAtThreshold: 0.97,
  /** „<= 2 / 160" aranykent, hogy mas keszletmeretre is ertelmes legyen. */
  highConfidenceErrorRate: 2 / 160,
  coverageAtThreshold: 0.4,
  noneOnUnresolvable: 0.7,
  providerErrorRate: 0.01,
  latencyP95Ms: 1500,
  /** Kategoriankenti precision/recall csak ennyi arany-elem felett ertelmes. */
  perCategoryMinItems: 8,
} as const;

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
}

export interface GoldenItem {
  readonly assetId: string;
  /** A helyes kategoria azonositoja; eldonthetetlen elemnel hianyozhat. */
  readonly primary: string | null;
  /** Minden elfogadhato kategoria azonositoja, a helyessel egyutt. */
  readonly accepted: ReadonlySet<string>;
  /** `UNRESOLVABLE_FROM_INPUT`: a vetuletbol nem donthető el. */
  readonly unresolvable: boolean;
}

export interface GoldenParseResult {
  readonly items: readonly GoldenItem[];
  /** Sorok, amikben meg nincs cimke -- nem hiba, a cimkezes folyik. */
  readonly unlabeled: number;
  /** Sorok, amiket nem lehetett ertelmezni, sorszammal es okkal. */
  readonly errors: readonly string[];
}

/** Idezojeles mezot is ismero CSV-olvaso; az elvalasztot a fejlec dönti el. */
export function parseCsv(szoveg: string): string[][] {
  const tiszta = szoveg.replace(/^﻿/, "");
  const elso = tiszta.split(/\r?\n/, 1)[0] ?? "";
  const elvalaszto =
    (elso.match(/;/g)?.length ?? 0) >= (elso.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const sorok: string[][] = [];
  let sor: string[] = [];
  let mezo = "";
  let idezet = false;
  for (let i = 0; i < tiszta.length; i++) {
    const c = tiszta[i] as string;
    if (idezet) {
      if (c === '"' && tiszta[i + 1] === '"') {
        mezo += '"';
        i++;
      } else if (c === '"') idezet = false;
      else mezo += c;
    } else if (c === '"') idezet = true;
    else if (c === elvalaszto) {
      sor.push(mezo);
      mezo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && tiszta[i + 1] === "\n") i++;
      sor.push(mezo);
      sorok.push(sor);
      sor = [];
      mezo = "";
    } else mezo += c;
  }
  if (mezo !== "" || sor.length) {
    sor.push(mezo);
    sorok.push(sor);
  }
  return sorok.filter((s) => s.some((m) => m.trim() !== ""));
}

const ALNEV = {
  asset: ["asset_id"],
  primary: ["helyes_kategoria", "helyes_kategoria_id", "correct_category_id"],
  accepted: ["elfogadhato_meg", "elfogadhato", "acceptable_category_ids"],
};

function fejlec(nev: string): string {
  return nev.trim().toLowerCase();
}

/**
 * A KATEGORIA AZONOSITOJA, NEVE VAGY KODJA IS ELFOGADOTT: a cimkezo tabla
 * nevet visz (ember irja), a kiertekelo azonositoval szamol (az atnevezes
 * nem rontja el a merest). Ismeretlen ertek hiba, nem csendes kimaradas.
 */
function kategoriaFeloldo(kategoriak: readonly CategoryOption[]) {
  const kulcs = (s: string) => s.normalize("NFC").trim().toLowerCase();
  const tabla = new Map<string, string>();
  for (const k of kategoriak) {
    tabla.set(kulcs(k.name), k.id);
    if (k.code) tabla.set(kulcs(k.code), k.id);
  }
  for (const k of kategoriak) tabla.set(kulcs(k.id), k.id);
  return (ertek: string): string | null => tabla.get(kulcs(ertek)) ?? null;
}

export function parseGoldenCsv(
  szoveg: string,
  kategoriak: readonly CategoryOption[],
): GoldenParseResult {
  const [fej, ...sorok] = parseCsv(szoveg);
  if (!fej) return { items: [], unlabeled: 0, errors: ["Üres fájl."] };
  const nevek = fej.map(fejlec);
  const oszlop = (alnevek: readonly string[]) =>
    nevek.findIndex((n) => alnevek.includes(n));
  const iAsset = oszlop(ALNEV.asset);
  const iPrimary = oszlop(ALNEV.primary);
  const iAccepted = oszlop(ALNEV.accepted);
  const iDontheto = nevek.findIndex((n) => n.startsWith("eldontheto"));
  const iUnresolvable = nevek.findIndex((n) => n.startsWith("unresolvable"));
  const hianyzo = [
    iAsset < 0 ? "asset_id" : null,
    iPrimary < 0 ? "HELYES_KATEGORIA" : null,
    iDontheto < 0 && iUnresolvable < 0 ? "ELDONTHETO… vagy UNRESOLVABLE" : null,
  ].filter(Boolean);
  if (hianyzo.length)
    return {
      items: [],
      unlabeled: 0,
      errors: [`Hiányzó oszlop: ${hianyzo.join(", ")}.`],
    };

  const felold = kategoriaFeloldo(kategoriak);
  const items: GoldenItem[] = [];
  const errors: string[] = [];
  let unlabeled = 0;
  sorok.forEach((sor, index) => {
    const sorszam = index + 2;
    const cella = (i: number) => (i >= 0 ? (sor[i] ?? "").trim() : "");
    const assetId = cella(iAsset);
    const primaryNyers = cella(iPrimary);
    const dontheto = cella(iDontheto).toLowerCase();
    const unresFlag = cella(iUnresolvable).toLowerCase();
    const unresolvable =
      dontheto === "nem" ||
      ["1", "true", "igen", "x", "unresolvable"].includes(unresFlag);
    if (!assetId) {
      errors.push(`${sorszam}. sor: nincs asset_id.`);
      return;
    }
    if (!primaryNyers && !unresolvable) {
      unlabeled++;
      return;
    }
    const primary = primaryNyers ? felold(primaryNyers) : null;
    if (primaryNyers && !primary) {
      errors.push(
        `${sorszam}. sor: ismeretlen kategória: ${JSON.stringify(primaryNyers)}.`,
      );
      return;
    }
    const tovabbi = cella(iAccepted);
    const tovabbiIds: string[] = [];
    if (tovabbi) {
      const egyben = felold(tovabbi);
      const reszek = egyben ? [tovabbi] : tovabbi.split(/[|,]/);
      for (const resz of reszek.map((r) => r.trim()).filter(Boolean)) {
        const id = felold(resz);
        if (!id) {
          errors.push(
            `${sorszam}. sor: ismeretlen elfogadható kategória: ${JSON.stringify(resz)}.`,
          );
          return;
        }
        tovabbiIds.push(id);
      }
    }
    items.push({
      assetId,
      primary,
      accepted: new Set([...(primary ? [primary] : []), ...tovabbiIds]),
      unresolvable,
    });
  });
  return { items, unlabeled, errors };
}

/** Egy elem eredmenye a kiertekeleshez -- a Jev-hivas kivonata. */
export type ItemOutcome =
  | {
      readonly ok: true;
      readonly choice: string;
      readonly confidence: number;
      readonly latencyMs: number;
    }
  | { readonly ok: false; readonly errorCode: string };

export interface Evaluated {
  readonly item: GoldenItem;
  readonly outcome: ItemOutcome;
}

function kvantilis(ertekek: readonly number[], q: number): number | null {
  if (ertekek.length === 0) return null;
  const rendezett = [...ertekek].sort((a, b) => a - b);
  const index = Math.min(
    rendezett.length - 1,
    Math.ceil(q * rendezett.length) - 1,
  );
  return rendezett[Math.max(0, index)] as number;
}

const arany = (szamlalo: number, nevezo: number) =>
  nevezo === 0 ? null : szamlalo / nevezo;

export interface CategoryMetric {
  readonly categoryId: string;
  readonly goldItems: number;
  readonly precision: number | null;
  readonly recall: number | null;
}

export interface EvaluationMetrics {
  readonly items: number;
  readonly resolvable: number;
  readonly unresolvable: number;
  readonly providerErrors: number;
  readonly providerErrorRate: number | null;
  /** Az eldontheto elemeken: a javaslat az elfogadhato halmazban, barmilyen bizonyossaggal. */
  readonly overallAgreement: number | null;
  /** A kuszob feletti, nem-NONE javaslatok aranya az eldontheto elemeken. */
  readonly coverageAtThreshold: number | null;
  /** A kuszob feletti, nem-NONE javaslatok kozul a helyesek aranya. */
  readonly accuracyAtThreshold: number | null;
  readonly highConfidenceErrors: number;
  readonly highConfidenceErrorRate: number | null;
  /** Az eldonthetetlen elemeken: NONE vagy kuszob alatti bizonyossag. */
  readonly noneOrLowOnUnresolvable: number | null;
  /** Az osszes sikeres valaszbol a NONE aranya. */
  readonly noneRate: number | null;
  readonly latencyP50Ms: number | null;
  readonly latencyP95Ms: number | null;
  readonly perCategory: readonly CategoryMetric[];
}

/**
 * A G PONT MEROSZAMAI. A definiciok, mert ezek nelkul egy szam semmit nem mond:
 *
 *   helyes           eldontheto elem, es a javaslat az elfogadhato halmazban
 *   kuszob feletti   bizonyossag >= kuszob ES a javaslat nem NONE
 *   magas bizonyossagu hiba   kuszob feletti, es nem helyes (eldonthetetlen
 *                    elemen adott biztos kategoria is ide tartozik)
 *
 * A szolgaltatoi hibas elem egyik aranyba sem kerul bele, csak a hibaaranyba:
 * nem mondott semmit, tehat se jo, se rossz valasz nem volt.
 */
export function evaluate(
  eredmenyek: readonly Evaluated[],
  kuszob: number = GO_THRESHOLDS.confidence,
): EvaluationMetrics {
  const sikeres = eredmenyek.filter(
    (e): e is Evaluated & { outcome: Extract<ItemOutcome, { ok: true }> } =>
      e.outcome.ok,
  );
  /*
    AZ ELDONTHETETLEN ELEMNEK NINCS "HELYES" KATEGORIAJA. Kulon aga itt nem kell:
    ahol a helyesseg szamit (kuszob feletti, nem-NONE javaslat), ott az
    eldonthetetlen elemre adott biztos kategoria mindig hiba, a NONE pedig oda
    be sem kerul. Az eldonthetetlen elem sajat meroszama a
    `noneOrLowOnUnresolvable`. (Kalibracio 2026-09-28: egy kulon NONE-ag
    kivetele egyetlen meroszamot sem valtoztatott -- halott ag volt.)
  */
  const helyes = (e: (typeof sikeres)[number]) =>
    !e.item.unresolvable && e.item.accepted.has(e.outcome.choice);
  const kuszobFelett = (e: (typeof sikeres)[number]) =>
    e.outcome.confidence >= kuszob && e.outcome.choice !== NONE_KEY;

  const donthetoOk = sikeres.filter((e) => !e.item.unresolvable);
  const donthetetlenOk = sikeres.filter((e) => e.item.unresolvable);
  const felett = sikeres.filter(kuszobFelett);
  const felettHiba = felett.filter((e) => !helyes(e));

  const kategoriak = new Map<string, number>();
  for (const e of eredmenyek)
    if (!e.item.unresolvable && e.item.primary)
      kategoriak.set(e.item.primary, (kategoriak.get(e.item.primary) ?? 0) + 1);
  const perCategory: CategoryMetric[] = [...kategoriak]
    .filter(([, db]) => db >= GO_THRESHOLDS.perCategoryMinItems)
    .map(([id, db]) => {
      const aranyban = donthetoOk.filter((e) => e.item.primary === id);
      const javasolt = sikeres.filter((e) => e.outcome.choice === id);
      return {
        categoryId: id,
        goldItems: db,
        recall: arany(aranyban.filter(helyes).length, aranyban.length),
        precision: arany(javasolt.filter(helyes).length, javasolt.length),
      };
    })
    .sort(
      (a, b) =>
        b.goldItems - a.goldItems || a.categoryId.localeCompare(b.categoryId),
    );

  const kesesek = sikeres.map((e) => e.outcome.latencyMs);
  const hibak = eredmenyek.length - sikeres.length;
  return {
    items: eredmenyek.length,
    resolvable: eredmenyek.filter((e) => !e.item.unresolvable).length,
    unresolvable: eredmenyek.filter((e) => e.item.unresolvable).length,
    providerErrors: hibak,
    providerErrorRate: arany(hibak, eredmenyek.length),
    overallAgreement: arany(
      donthetoOk.filter(helyes).length,
      donthetoOk.length,
    ),
    coverageAtThreshold: arany(
      donthetoOk.filter(kuszobFelett).length,
      donthetoOk.length,
    ),
    accuracyAtThreshold: arany(
      felett.length - felettHiba.length,
      felett.length,
    ),
    highConfidenceErrors: felettHiba.length,
    highConfidenceErrorRate: arany(felettHiba.length, sikeres.length),
    noneOrLowOnUnresolvable: arany(
      donthetetlenOk.filter(
        (e) => e.outcome.choice === NONE_KEY || e.outcome.confidence < kuszob,
      ).length,
      donthetetlenOk.length,
    ),
    noneRate: arany(
      sikeres.filter((e) => e.outcome.choice === NONE_KEY).length,
      sikeres.length,
    ),
    latencyP50Ms: kvantilis(kesesek, 0.5),
    latencyP95Ms: kvantilis(kesesek, 0.95),
    perCategory,
  };
}

export interface GateCheck {
  readonly metric: string;
  readonly value: number | null;
  readonly threshold: number;
  readonly direction: ">=" | "<=" | "<";
  readonly pass: boolean | null;
}

/** A technikai kuszobok vizsgalata. `null`: nincs adat, nem dontheto el. */
export function technicalGate(m: EvaluationMetrics): readonly GateCheck[] {
  const t = GO_THRESHOLDS;
  const check = (
    metric: string,
    value: number | null,
    direction: GateCheck["direction"],
    threshold: number,
  ): GateCheck => ({
    metric,
    value,
    threshold,
    direction,
    pass:
      value === null
        ? null
        : direction === ">="
          ? value >= threshold
          : direction === "<="
            ? value <= threshold
            : value < threshold,
  });
  return [
    check(
      "accuracyAtThreshold",
      m.accuracyAtThreshold,
      ">=",
      t.accuracyAtThreshold,
    ),
    check(
      "highConfidenceErrorRate",
      m.highConfidenceErrorRate,
      "<=",
      t.highConfidenceErrorRate,
    ),
    check(
      "coverageAtThreshold",
      m.coverageAtThreshold,
      ">=",
      t.coverageAtThreshold,
    ),
    check(
      "noneOrLowOnUnresolvable",
      m.noneOrLowOnUnresolvable,
      ">=",
      t.noneOnUnresolvable,
    ),
    check("providerErrorRate", m.providerErrorRate, "<", t.providerErrorRate),
    check("latencyP95Ms", m.latencyP95Ms, "<", t.latencyP95Ms),
  ];
}
