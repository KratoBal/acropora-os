/**
 * A BEERKEZO LEVEL PDF-JENEK BESOROLASA: A MERT KERES, KITAKARVA.
 *
 * Terv: nautilus `jev-level-szetvalogatas-terv-2026-10-01.md` 3. szelet; acrobot
 * 25784. A marveen `scripts/jev/offline.py` (`build("letter_class")`) es a
 * `shadow.py` (`_redacted_dto`) atirata: ezzel a keressel mertuk a DEV-et es a
 * HOLDOUT-ot r14-gyel. A tesztek a Python kimenetevel vetik ossze bajtra
 * (`redact-vectors/r11-expected.json`, `letter`).
 *
 * A szovegek (az utasitas, az osztalyok leirasa, a megorzott dokumentum-szavak)
 * a meres reszei; atirasuk uj meres es uj policy-verzio.
 */
import {
  JEV_MODEL,
  LETTER_CLASSES,
  LETTER_INSTRUCTIONS,
  LETTER_POLICY_KEY,
  LETTER_QUESTION_KEY,
  LETTER_TERMS,
  MAX_LETTER_CHARS,
  MAX_REDACT_CHARS,
  REDACTION_VERSION,
} from "./redact-r11-data.js";
import {
  dropHalfPlaceholder,
  RedactionError,
  Redactor,
  type RedactorOptions,
} from "./redact.js";

export { LETTER_CLASSES, LETTER_TERMS };

export const LETTER_CLASS_POLICY = {
  key: LETTER_POLICY_KEY,
  version: 1,
  /** Rogzitett modell; eltunese eseten a besorolas leall, nincs `jev-latest`. */
  model: JEV_MODEL,
  /** A projekcio sema-azonositoja a `DecisionRun.projectionHash`-ben. */
  schema: "invoice-collection.letter-class@1",
  /** Egy begyujtott fajl: `<forras>:<level-azonosito>:<fajlnev>`. */
  entityType: "InvoiceCollectionFile",
} as const;

/** A PDF elso ennyi sora ment a meresben (a DEV/HOLDOUT halmaz `head` mezoje). */
export const LETTER_HEAD_LINES = 40;

/** A kapcsolo: CSAK a kimondott `live` ertekre fut; minden mas KI. */
export function letterClassEnabled(value: string | undefined): boolean {
  return value?.trim() === "live";
}

/** Egy level egy PDF-je, ahogy a meres latta. */
export interface Letter {
  readonly subject: string;
  readonly fileName: string;
  /** A PDF szovegsorai (`pdfTextLines`); az elso 40 megy. */
  readonly lines: readonly string[];
}

/** Miert nem ment ki a keres; a Python `Blocked` kimenetei. */
export class LetterBlocked extends Error {
  constructor(
    readonly outcome:
      "blocked_too_long" | "blocked_redaction_error" | "blocked_runtime_guard",
    readonly detail = "",
  ) {
    super(outcome);
  }
}

export interface LetterRequest {
  /** `message`: kitakarva, vagva. */
  readonly state: Readonly<Record<string, string>>;
  readonly questionKey: string;
  readonly instructions: string;
  /** A nyolc osztaly, a meres sorrendjeben. */
  readonly criteria: Readonly<Record<string, string>>;
  readonly model: string;
  readonly redactionVersion: string;
  readonly placeholders: Readonly<Record<string, number>>;
}

/** offline.py `letter_text`, a halmaz `head` mezojevel egyutt. */
export function letterText(letter: Letter): string {
  const head = [
    `File: ${letter.fileName}`,
    ...letter.lines.slice(0, LETTER_HEAD_LINES),
  ].join("\n");
  return `Subject: ${letter.subject}\n${head}`;
}

/**
 * A kitakart keres. A kitakaro a level-feladat szavaival fut (LETTER_TERMS, a
 * Python `redact.preserving`), ezert itt epul, nem a hivotol jon: egy szavak
 * nelkuli kitakaro a dokumentum fajtajat jelolo szot is eltakarna, es az nem az a
 * keres, amit mertunk. `LetterBlocked`-ot dob, ha a szoveg nem mehet ki: ilyenkor
 * NINCS hivas, es a hivo nem esik vissza mas alakra.
 */
export function buildLetterRequest(
  options: Omit<RedactorOptions, "preserve">,
  letter: Letter,
): LetterRequest {
  const redactor = new Redactor({ ...options, preserve: LETTER_TERMS });
  const value = letterText(letter);
  // a Python kodpontban szamol: a hossz es a vagas is kodpontban megy
  if ([...value].length > MAX_REDACT_CHARS)
    throw new LetterBlocked("blocked_too_long");
  let r;
  try {
    r = redactor.redact(value);
  } catch (error) {
    if (error instanceof RedactionError)
      throw new LetterBlocked("blocked_redaction_error", error.message);
    throw error;
  }
  const problems = redactor.runtimeGuard(r);
  if (problems.length)
    throw new LetterBlocked("blocked_runtime_guard", problems.join(","));
  const message = dropHalfPlaceholder(
    [...r.text].slice(0, MAX_LETTER_CHARS).join(""),
  );
  // a vagott darab meg egyszer az or ele (a parositas P-016 szabalya); a Python
  // itt nem ellenoriz ujra, ez csak szigorubb lehet, engedekenyebb nem
  const cut = redactor.runtimeGuard({
    text: message,
    version: REDACTION_VERSION,
  });
  if (cut.length)
    throw new LetterBlocked("blocked_runtime_guard", cut.join(","));
  return {
    state: { message },
    questionKey: LETTER_QUESTION_KEY,
    instructions: LETTER_INSTRUCTIONS,
    criteria: { ...LETTER_CLASSES },
    model: JEV_MODEL,
    redactionVersion: REDACTION_VERSION,
    placeholders: { ...r.counts },
  };
}
