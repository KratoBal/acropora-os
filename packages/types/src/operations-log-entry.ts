import {
  type OperationsMeterRole,
  type OperationsTaskFieldDto,
  type OperationsTaskFieldType,
  type OperationsTaskFrequency,
} from "./operations-log.js";

/**
 * ÜZEMELTETÉSI NAPLÓ: A BEJEGYZÉS (task os-uzemeltetesi-naplo, S2a). Egy elvégzett rutin-feladat egy eszközön: a kezdés és a
 * befejezés időpontja (a telefon rögzíti), a résztvevők, a sablon mezőinek értékei és a rendellenesség.
 *
 * A SZABÁLYOK A SZERVEREN ÉS A TELEFONON IS EZEKBŐL A FÜGGVÉNYEKBŐL JÖNNEK: a mobil a beküldés előtt ugyanazt a mondatot adja,
 * amit a szerver adna, és az offline sorba csak olyan bejegyzés kerül, amelyet a szerver is elfogad.
 */
export const OPERATIONS_ENTRY_LIMITS = {
  noteMax: 2000,
  textValueMax: 2000,
  participantsMax: 20,
  /** A szám érték abszolút értéke ennél kisebb (a tárolás 19 jegyű, 6 tizedesű decimális). */
  numberAbsMax: 1_000_000_000_000,
  /** A telefon órája legfeljebb ennyivel (ms) járhat előre a szerverhez képest. */
  futureToleranceMs: 5 * 60 * 1000,
  /** Egy rögzítés legfeljebb ennyi ideig tarthat (ms): ennél hosszabb általában rossz telefon-óra. */
  maxDurationMs: 24 * 60 * 60 * 1000,
  clientOperationIdPattern: /^[A-Za-z0-9_.:-]{8,128}$/,
} as const;

export type OperationsEntryValue = number | boolean | string;

export interface OperationsLogEntryInput {
  /** A rögzítés idempotencia-kulcsa: az újraküldés ugyanazt a bejegyzést adja vissza, nem újat hoz létre. */
  clientOperationId: string;
  templateId: string;
  assetId: string;
  /**
   * A mezők kulcsai, amelyeket a telefon a rögzítéskor LÁTOTT (az akkori sablon). A kötelező-ellenőrzés csak ezekre szól: egy
   * offline rögzítés után felvett új kötelező mező nem utasítja el a régi bejegyzést.
   */
  templateFieldKeys: string[];
  startedAt: string;
  finishedAt: string;
  /** A rögzítőn kívüli résztvevők (a rögzítő mindig résztvevő). */
  participantIds?: string[];
  /** Mező-kulcs szerint; a fénykép mezők képei külön jönnek (S2b), itt nincs értékük. */
  values: Record<string, OperationsEntryValue>;
  anomaly?: boolean;
  anomalyNote?: string | null;
  internalNote?: string | null;
}

export interface OperationsLogEntryValueDto {
  fieldKey: string;
  fieldType: OperationsTaskFieldType;
  label: string;
  unit: string | null;
  meterRole: OperationsMeterRole | null;
  value: OperationsEntryValue;
}

export interface OperationsLogEntryPersonDto {
  id: string;
  displayName: string;
}

export interface OperationsLogEntryDto {
  id: string;
  clientOperationId: string | null;
  templateId: string;
  templateName: string;
  frequency: OperationsTaskFrequency;
  asset: { id: string; assetNumber: string; name: string };
  startedAt: string;
  finishedAt: string;
  recordedBy: OperationsLogEntryPersonDto;
  /** A rögzítő is benne van. */
  participants: OperationsLogEntryPersonDto[];
  anomaly: boolean;
  anomalyNote: string | null;
  internalNote: string | null;
  values: OperationsLogEntryValueDto[];
  createdAt: string;
}

export interface OperationsLogEntryCreateResponse {
  entry: OperationsLogEntryDto;
  /** Hamis: az újraküldés a már rögzített bejegyzést adta vissza. */
  created: boolean;
}

export interface OperationsLogEntryListResponse {
  items: OperationsLogEntryDto[];
  hasMore: boolean;
}

function validInstant(raw: string): number | null {
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : time;
}

/** Az érték „ki van töltve”: a szám és az igen/nem mindig, a szöveg csak ha nem üres. */
export function operationsEntryValueFilled(
  value: OperationsEntryValue | undefined,
): boolean {
  if (value === undefined) return false;
  return typeof value === "string" ? value.trim() !== "" : true;
}

/**
 * A BEJEGYZÉS SZABÁLYAI, magyar hibaüzenetekkel (üres lista: rendben). A `fields` a sablon MINDEN mezője (az aktívak és a
 * kivezetettek is: egy offline rögzítés közben kivezetett mező értéke még érvényes).
 *   - az idők érvényesek, a vége nem a kezdet előtt, egyik sem a jövőben, a tartam legfeljebb 24 óra;
 *   - minden érték egy ismert mezőhöz tartozik, és a típusának megfelel (szám véges és korlátos, szöveg legfeljebb 2000 karakter);
 *   - fénykép mezőhöz nincs érték (a képek külön jönnek);
 *   - a kötelező, AKTÍV és a rögzítéskor LÁTOTT mező ki van töltve;
 *   - rendellenességnél a szöveg kötelező, rendellenesség nélkül nincs ilyen szöveg;
 *   - legfeljebb 20 résztvevő, ismétlés nélkül.
 */
export function operationsEntryErrors(
  input: Pick<
    OperationsLogEntryInput,
    | "startedAt"
    | "finishedAt"
    | "values"
    | "templateFieldKeys"
    | "participantIds"
    | "anomaly"
    | "anomalyNote"
    | "internalNote"
  >,
  fields: readonly OperationsTaskFieldDto[],
  now: Date = new Date(),
): string[] {
  const limits = OPERATIONS_ENTRY_LIMITS;
  const errors: string[] = [];

  const started = validInstant(input.startedAt);
  const finished = validInstant(input.finishedAt);
  if (started === null) errors.push("A kezdés időpontja érvénytelen.");
  if (finished === null) errors.push("A befejezés időpontja érvénytelen.");
  if (started !== null && finished !== null) {
    if (finished < started)
      errors.push("A befejezés nem lehet a kezdés előtt.");
    else if (finished - started > limits.maxDurationMs)
      errors.push("Egy rögzítés legfeljebb 24 óráig tarthat.");
  }
  const latest = now.getTime() + limits.futureToleranceMs;
  if (
    (started !== null && started > latest) ||
    (finished !== null && finished > latest)
  )
    errors.push("Az időpont nem lehet a jövőben.");

  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(input.values)) {
    const field = byKey.get(key);
    if (!field) {
      errors.push(`Ismeretlen mező: ${key}.`);
      continue;
    }
    const name = `„${field.label}”`;
    if (field.type === "PHOTO") {
      errors.push(
        `${name}: a fényképet külön kell feltölteni, érték nem adható meg.`,
      );
    } else if (field.type === "NUMBER") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) >= limits.numberAbsMax
      )
        errors.push(`${name}: érvényes számot kell megadni.`);
    } else if (field.type === "BOOLEAN") {
      if (typeof value !== "boolean")
        errors.push(`${name}: igen vagy nem értéket kell megadni.`);
    } else if (typeof value !== "string") {
      errors.push(`${name}: szöveget kell megadni.`);
    } else if (value.length > limits.textValueMax) {
      errors.push(`${name}: legfeljebb ${limits.textValueMax} karakter lehet.`);
    }
  }

  const seen = new Set(input.templateFieldKeys);
  for (const field of fields) {
    if (
      field.removedAt === null &&
      field.required &&
      field.type !== "PHOTO" &&
      seen.has(field.key) &&
      !operationsEntryValueFilled(input.values[field.key])
    )
      errors.push(`„${field.label}”: kötelező kitölteni.`);
  }

  const note = (input.anomalyNote ?? "").trim();
  if (input.anomaly === true && note === "")
    errors.push("Rendellenességnél a leírás kötelező.");
  if (input.anomaly !== true && note !== "")
    errors.push("Rendellenesség nélkül nem adható meg rendellenesség-leírás.");
  if (note.length > limits.noteMax)
    errors.push(
      `A rendellenesség leírása legfeljebb ${limits.noteMax} karakter lehet.`,
    );
  if ((input.internalNote ?? "").trim().length > limits.noteMax)
    errors.push(
      `A belső megjegyzés legfeljebb ${limits.noteMax} karakter lehet.`,
    );

  const participants = input.participantIds ?? [];
  if (participants.length > limits.participantsMax)
    errors.push(`Legfeljebb ${limits.participantsMax} résztvevő adható meg.`);
  if (new Set(participants).size !== participants.length)
    errors.push("Egy résztvevő csak egyszer szerepelhet.");

  return errors;
}
