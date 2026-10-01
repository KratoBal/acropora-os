/**
 * A HIANYZO SZAMLAK PAROSITASA: A MERT KERES, KITAKARVA.
 *
 * A marveen `scripts/jev/offline.py` (`build("missing_invoice_pair")`) es a
 * `shadow.py` (`_redacted_dto`, `_combined_dto`) atirata. Ezzel a keressel
 * mertuk a DEV-et es a HOLDOUT-ot r11-gyel; a tesztek a Python kimenetevel
 * vetik ossze bajtra (`redact-vectors/r11-expected.json`, `pairing`).
 *
 * A szovegek (a mezo-cimkek, az utasitas, a NONE leirasa) a mereseik; atirasuk
 * uj meres es uj policy-verzio.
 */
import { pyre } from "./pyre.js";
import {
  JEV_MODEL,
  MAX_CANDIDATE_CHARS,
  MAX_QUERY_CHARS,
  MAX_REDACT_CHARS,
  OTHER,
  PAIR_CRITERION,
  PAIR_INSTRUCTIONS,
  PAIR_NONE,
  PAIR_POLICY_KEY,
  PAIR_QUESTION_KEY,
  PAIRING_KEEP,
  PAIRING_KNOWN_ALLOW,
  REDACTION_VERSION,
} from "./redact-r11-data.js";
import {
  dropHalfPlaceholder,
  RedactionError,
  type Redactor,
} from "./redact.js";

export { JEV_MODEL, PAIR_POLICY_KEY };

/** Egy banki terheles, ahogy a meres latta (minden mezo szoveg). */
export interface PairPayment {
  readonly date: string;
  readonly amount: string;
  readonly currency: string;
  /** "1999 HUF" alak, vagy ures. */
  readonly original: string;
  readonly partner: string;
  readonly narrative: string;
  readonly type: string;
}

/** Egy jelolt szamla, ahogy a meres latta. */
export interface PairCandidate {
  readonly number: string;
  readonly date: string;
  readonly gross: string;
  readonly currency: string;
  readonly supplier: string;
}

/** Miert nem ment ki a keres; a Python `Blocked` kimenetei. */
export class PairBlocked extends Error {
  constructor(
    readonly outcome:
      "blocked_too_long" | "blocked_redaction_error" | "blocked_runtime_guard",
    readonly detail = "",
  ) {
    super(outcome);
  }
}

export interface PairRequest {
  /** query, c0, c1, ... -- kitakarva, vagva. */
  readonly state: Readonly<Record<string, string>>;
  readonly questionKey: string;
  readonly instructions: string;
  /** c0..cN, majd NONE, ebben a sorrendben. */
  readonly criteria: Readonly<Record<string, string>>;
  readonly model: string;
  readonly redactionVersion: string;
  /** A helyorzok szama fajtankent, a lekerdezesre es a jeloltekre egyutt. */
  readonly placeholders: Readonly<Record<string, number>>;
}

export interface PairRequestWithDrops extends PairRequest {
  /** A kerdes c0, c1, ... kulcsa melyik BEADOTT jelolt (index a bemeneti listaban). */
  readonly candidateIndexes: readonly number[];
  /** A kiejtett jeloltek: a bemeneti index es az ok (a nev soha). */
  readonly dropped: readonly {
    index: number;
    outcome: string;
    detail: string;
  }[];
}

const COMPANY = pyre(OTHER.offlineCompany);

/**
 * Jogi forma nelkuli, nem kartyas-leiro partner = magansezemely: a neve a
 * kitakaras ELOTT kerul ki (Balazs: maganszemelynek utalasnal a nev sem megy ki).
 */
export function isPrivatePartner(name: string): boolean {
  return Boolean(name) && !COMPANY.test(name) && !name.includes("*");
}

function masked(text: string, name: string): string {
  return name && isPrivatePartner(name)
    ? text.split(name).join("<PRIVATE_PARTNER>")
    : text;
}

export function paymentText(p: PairPayment): string {
  const original = p.original ? ` (original: ${p.original})` : "";
  return masked(
    `Bank payment on ${p.date}: ${p.amount} ${p.currency}${original}; ` +
      `partner: ${p.partner}; reference: ${p.narrative}; type: ${p.type}.`,
    p.partner,
  );
}

export function candidateText(c: PairCandidate): string {
  return masked(
    `Invoice ${c.number}, issued ${c.date}, gross ${c.gross} ${c.currency}, issuer: ${c.supplier}.`,
    c.supplier,
  );
}

function redactedField(
  redactor: Redactor,
  value: string,
  limit: number,
  counts: Record<string, number>,
): string {
  // a Python kodpontban szamol: a hossz es a vagas is kodpontban megy
  if ([...value].length > MAX_REDACT_CHARS)
    throw new PairBlocked("blocked_too_long");
  let r;
  try {
    r = redactor.redact(value, { keepKinds: PAIRING_KEEP });
  } catch (error) {
    if (error instanceof RedactionError)
      throw new PairBlocked("blocked_redaction_error", error.message);
    throw error;
  }
  const problems = redactor.runtimeGuard(r, {
    allowKnownKinds: PAIRING_KNOWN_ALLOW,
  });
  if (problems.length)
    throw new PairBlocked("blocked_runtime_guard", problems.join(","));
  for (const [k, v] of Object.entries(r.counts))
    counts[k] = (counts[k] ?? 0) + v;
  return dropHalfPlaceholder([...r.text].slice(0, limit).join(""));
}

function guardCut(redactor: Redactor, text: string): void {
  const problems = redactor.runtimeGuard(
    { text, version: REDACTION_VERSION },
    { allowKnownKinds: PAIRING_KNOWN_ALLOW },
  );
  if (problems.length)
    throw new PairBlocked("blocked_runtime_guard", problems.join(","));
}

function pairCriteria(count: number): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (let i = 0; i < count; i++)
    criteria[`c${i}`] = PAIR_CRITERION.split("{i}").join(String(i));
  criteria.NONE = PAIR_NONE;
  return criteria;
}

/**
 * A KERES A KIEJTETT JELOLTEKKEL (acrobot dontese, 25560): az or ne az egesz
 * tetelt allitsa meg egy zavaro jelolt miatt, hanem azt a jeloltet ejtse ki, es
 * a tobbivel menjen tovabb. Barracuda merese (25559): a 2+3 r11-es blokkot mind
 * egyetlen zavaro jelolt valtotta ki (HANNA Instruments, a known-lista "HANNA"
 * aliasa jogi forma nelkul).
 *
 *   a lekerdezes nem mehet ki         -> `PairBlocked`, nincs hivas (mint eddig)
 *   egy jelolt nem mehet ki           -> kiesik; a tobbi kap c0, c1, ... kulcsot
 *   egyetlen jelolt sem marad         -> `PairBlocked`, nincs hivas
 *
 * Egy jelolt ugyanazon a ket orszuron megy at, mint a `buildPairRequest`-ben
 * (a teljes kitakart szovegen, majd a vagott darabon); a kiesett jelolt
 * helyorzoi nem szamitanak bele a keresbe.
 */
export function buildPairRequestDroppingBlocked(
  redactor: Redactor,
  payment: PairPayment,
  candidates: readonly PairCandidate[],
): PairRequestWithDrops {
  const placeholders: Record<string, number> = {};
  const query = redactedField(
    redactor,
    paymentText(payment),
    MAX_QUERY_CHARS,
    placeholders,
  );
  guardCut(redactor, query);
  const state: Record<string, string> = { query };
  const candidateIndexes: number[] = [];
  const dropped: { index: number; outcome: string; detail: string }[] = [];
  candidates.forEach((c, index) => {
    const local: Record<string, number> = {};
    try {
      const text = redactedField(
        redactor,
        candidateText(c),
        MAX_CANDIDATE_CHARS,
        local,
      );
      guardCut(redactor, text);
      state[`c${candidateIndexes.length}`] = text;
      candidateIndexes.push(index);
      for (const [k, v] of Object.entries(local))
        placeholders[k] = (placeholders[k] ?? 0) + v;
    } catch (error) {
      if (!(error instanceof PairBlocked)) throw error;
      dropped.push({ index, outcome: error.outcome, detail: error.detail });
    }
  });
  if (candidateIndexes.length === 0)
    throw new PairBlocked("blocked_runtime_guard", "no candidate left");
  return {
    state,
    questionKey: PAIR_QUESTION_KEY,
    instructions: PAIR_INSTRUCTIONS,
    criteria: pairCriteria(candidateIndexes.length),
    model: JEV_MODEL,
    redactionVersion: REDACTION_VERSION,
    placeholders,
    candidateIndexes,
    dropped,
  };
}

/**
 * A kitakart keres. `PairBlocked`-ot dob, ha barmelyik darab nem mehet ki: ilyenkor
 * NINCS hivas, es a hivo nem esik vissza semmilyen mas alakra.
 */
export function buildPairRequest(
  redactor: Redactor,
  payment: PairPayment,
  candidates: readonly PairCandidate[],
): PairRequest {
  const placeholders: Record<string, number> = {};
  const state: Record<string, string> = {
    query: redactedField(
      redactor,
      paymentText(payment),
      MAX_QUERY_CHARS,
      placeholders,
    ),
  };
  candidates.forEach((c, i) => {
    state[`c${i}`] = redactedField(
      redactor,
      candidateText(c),
      MAX_CANDIDATE_CHARS,
      placeholders,
    );
  });
  // P-016: az osszerakott keres minden darabja meg egyszer az or ele
  for (const text of Object.values(state)) {
    const problems = redactor.runtimeGuard(
      { text, version: REDACTION_VERSION },
      { allowKnownKinds: PAIRING_KNOWN_ALLOW },
    );
    if (problems.length)
      throw new PairBlocked("blocked_runtime_guard", problems.join(","));
  }
  const criteria: Record<string, string> = {};
  candidates.forEach((_, i) => {
    criteria[`c${i}`] = PAIR_CRITERION.split("{i}").join(String(i));
  });
  criteria.NONE = PAIR_NONE;
  return {
    state,
    questionKey: PAIR_QUESTION_KEY,
    instructions: PAIR_INSTRUCTIONS,
    criteria,
    model: JEV_MODEL,
    redactionVersion: REDACTION_VERSION,
    placeholders,
  };
}
