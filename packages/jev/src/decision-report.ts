/**
 * A V1 PILOT MERESI RIPORTJA A `DecisionRun` TABLABOL -- tiszta fuggvenyek,
 * halozat es adatbazis nelkul.
 *
 * Szerzodes: KratoBal/acropora-os #1199, ACD-009 (komment 5870009352): a
 * riport-szkript keszuljon el, mielott a pilot eleri az 50 SHOWN + 10
 * HIDDEN-kontroll review triggert (P-012). A tartalom az ACD-009 listaja.
 *
 * CSAK AGGREGATUM. A `projectionPayload` nem resze a bemenetnek: a futtato
 * legfeljebb nehany pelda nevet olvassa ki kulon, azonositoval (PD-001).
 *
 *   SHOWN               ACCEPTED / OVERRIDDEN
 *   HIDDEN              SHADOW_MATCH / SHADOW_MISMATCH, csoportonkent:
 *     control           jogosult lett volna (11 kod, >= 0,90), a 10% kontroll
 *     rare              a 17 ritka (nem validalt) kategoria valamelyike
 *     low_confidence    validalt kategoria, 0,90 alatt
 *     none              a Jev NONE-t valasztott
 *     unknown_category  a valasztott azonosito ma nincs a kategoriak kozott
 *   EXPIRED             a tabla nem irja: itt szamolodik (Council D4)
 */
import { NONE_KEY, kvantilis } from "./evaluation.js";
import {
  PREFILL_CONFIDENCE_THRESHOLD,
  PREFILL_VISIBLE_CATEGORY_CODES,
  prefillExposure,
} from "./asset-category-prefill.js";

/** A review trigger (P-012, ACD-009): ennyi FELOLDOTT dontes kell. */
export const REVIEW_TRIGGER = { shown: 50, hiddenControl: 10 } as const;

/**
 * EXPIRED (Council D4): „14 napon belul nincs kategoria". A letrehozo urlapon
 * a futas a mentessel kotodik az eszkozhoz; amelyik 14 nap utan sincs
 * eszkozhoz kotve es feloldva, azt az urlapot elhagytak.
 */
export const EXPIRY_DAYS = 14;

export type StoredResolution =
  | "ACCEPTED"
  | "OVERRIDDEN"
  | "SHADOW_MATCH"
  | "SHADOW_MISMATCH"
  | "STALE"
  | "EXPIRED";

/** A riport egy futasrol ennyit lat. Szemelyes adat es vetulet nincs benne. */
export interface DecisionRunRow {
  readonly id: string;
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly optionsHash: string;
  readonly requestedModel: string;
  readonly respondedModel: string | null;
  readonly selectedValue: string | null;
  readonly confidence: number | null;
  readonly exposure: "HIDDEN" | "SHOWN";
  readonly resolution: StoredResolution | null;
  readonly resolvedValue: string | null;
  readonly status: "OK" | "ERROR";
  readonly latencyMs: number | null;
  readonly errorCode: string | null;
  readonly entityId: string | null;
  readonly clientOperationId: string | null;
  readonly createdAt: Date;
}

export interface ReportCategory {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
}

/**
 * EGY FUTAS KIMENETELE. A tarolt feloldas mellett:
 *   EXPIRED      nincs feloldva, nincs eszkozhoz kotve, es regebbi 14 napnal
 *   OPEN         nincs feloldva, nincs kotve, 14 napon belul (az urlap meg elhet)
 *   UNRESOLVED   eszkozhoz kotve, feloldas nelkul -- a HIBAS futasnal ez a
 *                rendes eset (nincs javaslata), OK futasnal rendellenesseg
 */
export type RunOutcome = StoredResolution | "OPEN" | "UNRESOLVED";

export function runOutcome(row: DecisionRunRow, now: Date): RunOutcome {
  if (row.resolution !== null) return row.resolution;
  if (row.entityId !== null) return "UNRESOLVED";
  const kor = now.getTime() - row.createdAt.getTime();
  return kor >= EXPIRY_DAYS * 24 * 60 * 60 * 1000 ? "EXPIRED" : "OPEN";
}

export type HiddenGroup =
  "control" | "rare" | "low_confidence" | "none" | "unknown_category";

/** Miert rejtett egy (sikeres) futas. A sorrend a `prefillExposure` feltetelei. */
export function hiddenGroup(
  row: Pick<DecisionRunRow, "selectedValue" | "confidence">,
  category: ReportCategory | undefined,
): HiddenGroup {
  if (row.selectedValue === null || row.selectedValue === NONE_KEY)
    return "none";
  if (!category) return "unknown_category";
  if (
    category.code === null ||
    !PREFILL_VISIBLE_CATEGORY_CODES.has(category.code)
  )
    return "rare";
  if (row.confidence === null || row.confidence < PREFILL_CONFIDENCE_THRESHOLD)
    return "low_confidence";
  return "control";
}

export interface Rate {
  readonly hits: number;
  readonly total: number;
  readonly value: number;
  /** Wilson-intervallum, 95%. Kis mintan ez mondja meg, mennyit er a szam. */
  readonly ci95: readonly [number, number];
}

export function rate(hits: number, total: number): Rate | null {
  if (total === 0) return null;
  const z = 1.96;
  const p = hits / total;
  const nevezo = 1 + (z * z) / total;
  const kozep = (p + (z * z) / (2 * total)) / nevezo;
  const fel =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
    nevezo;
  return {
    hits,
    total,
    value: p,
    ci95: [Math.max(0, kozep - fel), Math.min(1, kozep + fel)],
  };
}

/** Egy csoport feloldasainak szamlaloi. `*Empty`: kategoria NELKUL mentve. */
export interface OutcomeCounts {
  readonly runs: number;
  readonly accepted: number;
  readonly overridden: number;
  readonly overriddenEmpty: number;
  readonly shadowMatch: number;
  readonly shadowMismatch: number;
  readonly shadowMismatchEmpty: number;
  readonly stale: number;
  readonly expired: number;
  readonly open: number;
  readonly unresolved: number;
}

function szamlal(sorok: readonly DecisionRunRow[], now: Date): OutcomeCounts {
  const c = {
    runs: sorok.length,
    accepted: 0,
    overridden: 0,
    overriddenEmpty: 0,
    shadowMatch: 0,
    shadowMismatch: 0,
    shadowMismatchEmpty: 0,
    stale: 0,
    expired: 0,
    open: 0,
    unresolved: 0,
  };
  for (const sor of sorok) {
    const ki = runOutcome(sor, now);
    if (ki === "ACCEPTED") c.accepted++;
    else if (ki === "OVERRIDDEN") {
      c.overridden++;
      if (sor.resolvedValue === null) c.overriddenEmpty++;
    } else if (ki === "SHADOW_MATCH") c.shadowMatch++;
    else if (ki === "SHADOW_MISMATCH") {
      c.shadowMismatch++;
      if (sor.resolvedValue === null) c.shadowMismatchEmpty++;
    } else if (ki === "STALE") c.stale++;
    else if (ki === "EXPIRED") c.expired++;
    else if (ki === "OPEN") c.open++;
    else c.unresolved++;
  }
  return c;
}

/** A kalibracio savjai: [from, to), az utolso zart. */
export const CONFIDENCE_BANDS: readonly (readonly [number, number])[] = [
  [0, 0.5],
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 0.95],
  [0.95, 1],
];

export interface CalibrationBand {
  readonly from: number;
  readonly to: number;
  readonly runs: number;
  readonly meanConfidence: number | null;
  /** Talalat: ACCEPTED vagy SHADOW_MATCH, a feloldott (nem STALE) futasokon. */
  readonly hitRate: Rate | null;
  /** Ugyanez csak a rejtett futasokon: ott a lathato javaslat nem horgonyoz. */
  readonly hiddenHitRate: Rate | null;
}

export interface RareCategoryResult {
  readonly categoryId: string;
  readonly code: string | null;
  readonly name: string;
  readonly counts: OutcomeCounts;
  readonly matchRate: Rate | null;
  readonly meanConfidence: number | null;
}

export interface Example {
  readonly runId: string;
  readonly kind: "OVERRIDDEN" | "SHADOW_MISMATCH";
  readonly group: "shown" | HiddenGroup;
  readonly confidence: number | null;
  readonly selected: string;
  readonly resolved: string;
  /** A vetitett nev; a futtato tolti ki, peldankent kulon olvasva. */
  name?: string | null;
}

export interface Tally {
  readonly value: string;
  readonly runs: number;
}

export interface DecisionReport {
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly generatedAt: string;
  readonly expiryDays: number;
  readonly window: { readonly first: string; readonly last: string } | null;
  readonly runs: {
    readonly total: number;
    readonly ok: number;
    readonly error: number;
  };
  readonly shown: OutcomeCounts & { readonly acceptance: Rate | null };
  readonly hidden: {
    readonly runs: number;
    readonly groups: Readonly<
      Record<HiddenGroup, OutcomeCounts & { readonly matchRate: Rate | null }>
    >;
  };
  /**
   * A HORGONYHATAS BECSLESE: a lathato javaslat elfogadasi aranya mínusz a
   * kontroll egyezesi aranya. A kontroll UGYANAZ a feltetelhalmaz (11 kod,
   * >= 0,90), csak a felhasznalo nem latta: a kulonbseg az, amit a latvany
   * hozzatesz. Pozitiv: az emberek a lathatot tobbszor hagyjak meg.
   */
  readonly anchoring: {
    readonly shownAcceptance: Rate | null;
    readonly controlMatch: Rate | null;
    readonly delta: number | null;
  };
  readonly calibration: {
    readonly bands: readonly CalibrationBand[];
    readonly noneRuns: number;
  };
  readonly rareCategories: readonly RareCategoryResult[];
  readonly errors: {
    readonly rate: Rate | null;
    readonly byCode: readonly Tally[];
  };
  readonly latency: {
    readonly okP50Ms: number | null;
    readonly okP95Ms: number | null;
    readonly allP50Ms: number | null;
    readonly allP95Ms: number | null;
  };
  readonly identity: {
    /** A kulcs OSSZES futasa, verziotol fuggetlenul: itt latszik a drift. */
    readonly policyVersions: readonly Tally[];
    readonly requestedModels: readonly Tally[];
    readonly optionsHashes: readonly Tally[];
    readonly respondedModelMismatch: number;
    readonly respondedModelMissing: number;
  };
  readonly lifecycle: {
    readonly stale: Rate | null;
    readonly expired: Rate | null;
    readonly open: number;
  };
  readonly consistency: {
    /** Tarolt `exposure` != a mai szabalybol ujraszamolt. Nulla a vart. */
    readonly exposureMismatch: number;
    readonly missingOperationId: number;
    /** Sikeres futas eszkozhoz kotve, feloldas nelkul. Nulla a vart. */
    readonly okUnresolved: number;
  };
  readonly trigger: {
    readonly shownDecisions: number;
    readonly shownRequired: number;
    readonly controlDecisions: number;
    readonly controlRequired: number;
    readonly met: boolean;
  };
  readonly examples: Example[];
}

function tallyzo(ertekek: readonly string[]): Tally[] {
  const m = new Map<string, number>();
  for (const e of ertekek) m.set(e, (m.get(e) ?? 0) + 1);
  return [...m]
    .map(([value, runs]) => ({ value, runs }))
    .sort((a, b) => b.runs - a.runs || a.value.localeCompare(b.value));
}

function atlag(ertekek: readonly number[]): number | null {
  return ertekek.length
    ? ertekek.reduce((a, b) => a + b, 0) / ertekek.length
    : null;
}

const MAX_EXAMPLES = 10;

export function decisionReport(input: {
  /** A policy-kulcs osszes futasa (a drifthez); a meroszamok a verziora szurnek. */
  readonly runs: readonly DecisionRunRow[];
  readonly categories: readonly ReportCategory[];
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly now: Date;
  /** Peldak szama tipusonkent; legfeljebb 10. */
  readonly examplesPerKind?: number;
}): DecisionReport {
  const { now } = input;
  const kategoria = new Map(input.categories.map((k) => [k.id, k]));
  const nev = (id: string | null) =>
    id === null
      ? "(kategória nélkül)"
      : id === NONE_KEY
        ? NONE_KEY
        : (kategoria.get(id)?.name ?? id);

  const kulcs = input.runs.filter((r) => r.policyKey === input.policyKey);
  const sorok = kulcs.filter((r) => r.policyVersion === input.policyVersion);
  const ok = sorok.filter((r) => r.status === "OK");
  const hibas = sorok.filter((r) => r.status === "ERROR");

  const shownSorok = ok.filter((r) => r.exposure === "SHOWN");
  const shown = szamlal(shownSorok, now);
  const acceptance = rate(shown.accepted, shown.accepted + shown.overridden);

  const csoportja = (r: DecisionRunRow) =>
    hiddenGroup(
      r,
      r.selectedValue ? kategoria.get(r.selectedValue) : undefined,
    );
  const hiddenSorok = ok.filter((r) => r.exposure === "HIDDEN");
  const CSOPORTOK: readonly HiddenGroup[] = [
    "control",
    "rare",
    "low_confidence",
    "none",
    "unknown_category",
  ];
  const groups = Object.fromEntries(
    CSOPORTOK.map((g) => {
      const c = szamlal(
        hiddenSorok.filter((r) => csoportja(r) === g),
        now,
      );
      return [
        g,
        {
          ...c,
          matchRate: rate(c.shadowMatch, c.shadowMatch + c.shadowMismatch),
        },
      ];
    }),
  ) as DecisionReport["hidden"]["groups"];

  const controlMatch = groups.control.matchRate;
  const delta =
    acceptance && controlMatch ? acceptance.value - controlMatch.value : null;

  /* KALIBRACIO: a NONE-valasztas nem egyezhet semmivel, kulon szamoljuk. */
  const kalibralhato = ok.filter(
    (r) =>
      r.selectedValue !== null &&
      r.selectedValue !== NONE_KEY &&
      r.confidence !== null,
  );
  const talalat = (r: DecisionRunRow) => {
    const ki = runOutcome(r, now);
    return ki === "ACCEPTED" || ki === "SHADOW_MATCH";
  };
  const feloldott = (r: DecisionRunRow) => {
    const ki = runOutcome(r, now);
    return (
      ki === "ACCEPTED" ||
      ki === "OVERRIDDEN" ||
      ki === "SHADOW_MATCH" ||
      ki === "SHADOW_MISMATCH"
    );
  };
  const bands = CONFIDENCE_BANDS.map(([from, to], i) => {
    const utolso = i === CONFIDENCE_BANDS.length - 1;
    const bent = kalibralhato.filter((r) => {
      const c = r.confidence as number;
      return c >= from && (utolso ? c <= to : c < to);
    });
    const f = bent.filter(feloldott);
    const fh = f.filter((r) => r.exposure === "HIDDEN");
    return {
      from,
      to,
      runs: bent.length,
      meanConfidence: atlag(bent.map((r) => r.confidence as number)),
      hitRate: rate(f.filter(talalat).length, f.length),
      hiddenHitRate: rate(fh.filter(talalat).length, fh.length),
    };
  });

  /* A RITKA KATEGORIAK ARNYEK-EREDMENYE, kategoriankent. */
  const ritka = new Map<string, DecisionRunRow[]>();
  for (const r of hiddenSorok)
    if (csoportja(r) === "rare") {
      const id = r.selectedValue as string;
      ritka.set(id, [...(ritka.get(id) ?? []), r]);
    }
  const rareCategories = [...ritka]
    .map(([id, rs]) => {
      const counts = szamlal(rs, now);
      return {
        categoryId: id,
        code: kategoria.get(id)?.code ?? null,
        name: nev(id),
        counts,
        matchRate: rate(
          counts.shadowMatch,
          counts.shadowMatch + counts.shadowMismatch,
        ),
        meanConfidence: atlag(
          rs.flatMap((r) => (r.confidence === null ? [] : [r.confidence])),
        ),
      };
    })
    .sort(
      (a, b) => b.counts.runs - a.counts.runs || a.name.localeCompare(b.name),
    );

  const kesesek = (rs: readonly DecisionRunRow[]) =>
    rs.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));

  /* A TAROLT LATHATOSAG A MAI SZABALLYAL: egy eltero sor kodvaltast vagy
     atnevezett kategoria-kodot jelez, es a csoportositas akkor felrevezet. */
  let exposureMismatch = 0;
  let missingOperationId = 0;
  for (const r of ok) {
    if (r.clientOperationId === null) {
      missingOperationId++;
      continue;
    }
    const ujra = prefillExposure({
      selectedValue: r.selectedValue,
      categoryCode: r.selectedValue
        ? (kategoria.get(r.selectedValue)?.code ?? null)
        : null,
      confidence: r.confidence,
      clientOperationId: r.clientOperationId,
      policyVersion: r.policyVersion,
    });
    if (ujra !== r.exposure) exposureMismatch++;
  }

  const kimenetek = ok.map((r) => runOutcome(r, now));
  const db = (k: RunOutcome) => kimenetek.filter((x) => x === k).length;

  /* PELDAK: a legmagasabb bizonyossagu felulirasok es arnyek-elteresek. */
  const n = Math.max(0, Math.min(MAX_EXAMPLES, input.examplesPerKind ?? 3));
  const peldak = (
    kind: Example["kind"],
    rs: readonly DecisionRunRow[],
  ): Example[] =>
    rs
      .filter((r) => runOutcome(r, now) === kind)
      .sort(
        (a, b) =>
          (b.confidence ?? -1) - (a.confidence ?? -1) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, n)
      .map((r) => ({
        runId: r.id,
        kind,
        group: r.exposure === "SHOWN" ? "shown" : csoportja(r),
        confidence: r.confidence,
        selected: nev(r.selectedValue),
        resolved: nev(r.resolvedValue),
      }));

  const idok = sorok.map((r) => r.createdAt.getTime()).sort((a, b) => a - b);
  const shownDecisions = shown.accepted + shown.overridden;
  const controlDecisions =
    groups.control.shadowMatch + groups.control.shadowMismatch;

  return {
    policyKey: input.policyKey,
    policyVersion: input.policyVersion,
    generatedAt: now.toISOString(),
    expiryDays: EXPIRY_DAYS,
    window: idok.length
      ? {
          first: new Date(idok[0] as number).toISOString(),
          last: new Date(idok[idok.length - 1] as number).toISOString(),
        }
      : null,
    runs: { total: sorok.length, ok: ok.length, error: hibas.length },
    shown: { ...shown, acceptance },
    hidden: { runs: hiddenSorok.length, groups },
    anchoring: { shownAcceptance: acceptance, controlMatch, delta },
    calibration: {
      bands,
      noneRuns: ok.filter((r) => r.selectedValue === NONE_KEY).length,
    },
    rareCategories,
    errors: {
      rate: rate(hibas.length, sorok.length),
      byCode: tallyzo(hibas.map((r) => r.errorCode ?? "(nincs kód)")),
    },
    latency: {
      okP50Ms: kvantilis(kesesek(ok), 0.5),
      okP95Ms: kvantilis(kesesek(ok), 0.95),
      allP50Ms: kvantilis(kesesek(sorok), 0.5),
      allP95Ms: kvantilis(kesesek(sorok), 0.95),
    },
    identity: {
      policyVersions: tallyzo(kulcs.map((r) => String(r.policyVersion))),
      requestedModels: tallyzo(sorok.map((r) => r.requestedModel)),
      optionsHashes: tallyzo(sorok.map((r) => r.optionsHash)),
      respondedModelMismatch: ok.filter(
        (r) =>
          r.respondedModel !== null && r.respondedModel !== r.requestedModel,
      ).length,
      respondedModelMissing: ok.filter((r) => r.respondedModel === null).length,
    },
    lifecycle: {
      stale: rate(db("STALE"), ok.length),
      expired: rate(db("EXPIRED"), ok.length),
      open: db("OPEN"),
    },
    consistency: {
      exposureMismatch,
      missingOperationId,
      okUnresolved: db("UNRESOLVED"),
    },
    trigger: {
      shownDecisions,
      shownRequired: REVIEW_TRIGGER.shown,
      controlDecisions,
      controlRequired: REVIEW_TRIGGER.hiddenControl,
      met:
        shownDecisions >= REVIEW_TRIGGER.shown &&
        controlDecisions >= REVIEW_TRIGGER.hiddenControl,
    },
    examples: [
      ...peldak("OVERRIDDEN", shownSorok),
      ...peldak("SHADOW_MISMATCH", hiddenSorok),
    ],
  };
}

const szazalek = (x: number | null) =>
  x === null ? "–" : `${(x * 100).toFixed(1)}%`;
const ms = (x: number | null) => (x === null ? "–" : `${Math.round(x)} ms`);
const tized = (x: number | null) => (x === null ? "–" : x.toFixed(2));
const arany = (r: Rate | null) =>
  r === null
    ? "–"
    : `${szazalek(r.value)} (${r.hits}/${r.total}; 95%: ${szazalek(r.ci95[0])}–${szazalek(r.ci95[1])})`;
const tally = (t: readonly Tally[]) =>
  t.length ? t.map((x) => `\`${x.value}\` ${x.runs}`).join(", ") : "–";

const CSOPORT_NEV: Record<HiddenGroup, string> = {
  control: "10%-os kontroll (jogosult lett volna)",
  rare: "ritka kategória (a 17 közül)",
  low_confidence: "validált kategória, 0,90 alatt",
  none: "NONE",
  unknown_category: "ismeretlen kategória-azonosító",
};

/** Az emberi olvasatra szant osszefoglalo. */
export function decisionReportMarkdown(r: DecisionReport): string {
  const g = r.hidden.groups;
  const csoportSor = (k: HiddenGroup) => {
    const c = g[k];
    return `| ${CSOPORT_NEV[k]} | ${c.runs} | ${c.shadowMatch} | ${c.shadowMismatch} (üresen ${c.shadowMismatchEmpty}) | ${c.stale} | ${c.expired} | ${c.open} | ${arany(c.matchRate)} |`;
  };
  const savok = r.calibration.bands
    .map(
      (b) =>
        `| ${b.from.toFixed(2)}–${b.to.toFixed(2)} | ${b.runs} | ${tized(b.meanConfidence)} | ${arany(b.hitRate)} | ${arany(b.hiddenHitRate)} |`,
    )
    .join("\n");
  const ritka = r.rareCategories
    .map(
      (k) =>
        `| ${k.name}${k.code ? ` (${k.code})` : ""} | ${k.counts.runs} | ${k.counts.shadowMatch} | ${k.counts.shadowMismatch} | ${k.counts.stale + k.counts.expired + k.counts.open} | ${tized(k.meanConfidence)} | ${arany(k.matchRate)} |`,
    )
    .join("\n");
  const peldak = r.examples
    .map(
      (p) =>
        `| ${p.kind} | ${p.group} | ${p.name ?? "–"} | ${p.selected} | ${p.resolved} | ${tized(p.confidence)} |`,
    )
    .join("\n");
  const t = r.trigger;
  const c = r.consistency;
  return [
    `# Jev V1 pilot riport: ${r.policyKey}@${r.policyVersion}`,
    "",
    `- készült: ${r.generatedAt}`,
    r.window
      ? `- futások: ${r.window.first} – ${r.window.last}`
      : "- futások: nincs egy sem",
    `- futás: ${r.runs.total} (sikeres ${r.runs.ok}, hibás ${r.runs.error})`,
    "",
    "## Review trigger (P-012: 50 SHOWN + 10 HIDDEN-kontroll)",
    "",
    `- SHOWN döntés (ACCEPTED + OVERRIDDEN): **${t.shownDecisions} / ${t.shownRequired}**`,
    `- HIDDEN-kontroll döntés (SHADOW_MATCH + SHADOW_MISMATCH): **${t.controlDecisions} / ${t.controlRequired}**`,
    `- teljesült: **${t.met ? "IGEN" : "NEM"}**`,
    "",
    "## SHOWN",
    "",
    `- futás ${r.shown.runs}: ACCEPTED ${r.shown.accepted}, OVERRIDDEN ${r.shown.overridden} (ebből kategória nélkül mentve ${r.shown.overriddenEmpty}), STALE ${r.shown.stale}, EXPIRED ${r.shown.expired}, nyitott ${r.shown.open}`,
    `- elfogadási arány: ${arany(r.shown.acceptance)}`,
    "",
    "## HIDDEN",
    "",
    "| csoport | futás | SHADOW_MATCH | SHADOW_MISMATCH | STALE | EXPIRED | nyitott | egyezés |",
    "|---|---|---|---|---|---|---|---|",
    csoportSor("control"),
    csoportSor("rare"),
    csoportSor("low_confidence"),
    csoportSor("none"),
    csoportSor("unknown_category"),
    "",
    "## Shown kontra hidden (a horgonyhatás becslése)",
    "",
    `- SHOWN elfogadás: ${arany(r.anchoring.shownAcceptance)}`,
    `- kontroll egyezés: ${arany(r.anchoring.controlMatch)}`,
    `- különbség: **${r.anchoring.delta === null ? "–" : `${(r.anchoring.delta * 100).toFixed(1)} százalékpont`}**`,
    "",
    "A kontroll ugyanaz a feltétel (11 kód, ≥ 0,90), csak a felhasználó nem látta a javaslatot. Kis mintán az intervallumok átfedése a lényeg, nem a különbség előjele.",
    "",
    "## Bizonyosság és kalibráció",
    "",
    "Találat: ACCEPTED vagy SHADOW_MATCH, a feloldott futásokon (STALE, EXPIRED, nyitott nélkül). A NONE-választás nem kalibrálható, mert nem egyezhet mentett kategóriával.",
    "",
    "| sáv | futás | átlag | találat | ebből rejtett |",
    "|---|---|---|---|---|",
    savok,
    "",
    `NONE-választás: ${r.calibration.noneRuns}`,
    "",
    "## Ritka kategóriák árnyék-eredménye",
    "",
    r.rareCategories.length
      ? `| kategória | futás | egyezés | eltérés | nem feloldott | átlag bizonyosság | egyezési arány |\n|---|---|---|---|---|---|---|\n${ritka}`
      : "Ritka kategóriára nem volt futás.",
    "",
    "## Hibák és késleltetés",
    "",
    `- hibaarány: ${arany(r.errors.rate)}`,
    `- hibakódok: ${tally(r.errors.byCode)}`,
    `- késleltetés, sikeres: p50 ${ms(r.latency.okP50Ms)}, p95 ${ms(r.latency.okP95Ms)}`,
    `- késleltetés, összes: p50 ${ms(r.latency.allP50Ms)}, p95 ${ms(r.latency.allP95Ms)}`,
    "",
    "## Modell és policy identitás",
    "",
    `- policy-verziók a kulcson (minden futás): ${tally(r.identity.policyVersions)}`,
    `- kért modell: ${tally(r.identity.requestedModels)}`,
    `- opció-halmaz (optionsHash): ${tally(r.identity.optionsHashes)}`,
    `- válaszoló modell eltér a kérttől: ${r.identity.respondedModelMismatch}; hiányzik (sikeres futáson): ${r.identity.respondedModelMissing}`,
    "",
    "## STALE és EXPIRED",
    "",
    `- STALE: ${arany(r.lifecycle.stale)}`,
    `- EXPIRED (${r.expiryDays} nap után sincs eszközhöz kötve; a tábla nem írja, itt számolódik): ${arany(r.lifecycle.expired)}`,
    `- még nyitott (${r.expiryDays} napon belül): ${r.lifecycle.open}`,
    "",
    "## Konzisztencia (nulla a várt)",
    "",
    `- tárolt láthatóság eltér a mai szabálytól: ${c.exposureMismatch}`,
    `- művelet-azonosító nélküli sikeres futás: ${c.missingOperationId}`,
    `- sikeres futás eszközhöz kötve, feloldás nélkül: ${c.okUnresolved}`,
    "",
    "## Példák (a legbiztosabb felülírások és árnyék-eltérések)",
    "",
    r.examples.length
      ? `| fajta | csoport | vetített név | Jev | ember | bizonyosság |\n|---|---|---|---|---|---|\n${peldak}`
      : "Nincs példa.",
    "",
  ].join("\n");
}
