// RELATÍV ÚT, NEM `@/`: a teszt-fordító nem ismeri az aliast (`tsconfig.test.json`-ban nincs `paths`).
import type { PickedFile } from "../api/picked-image";
import type {
  CreateOperationsEntryInput,
  OperationsEntryValue,
  OperationsTemplate,
  OperationsTemplateField,
} from "./types";
import { operationsEntryOperationId } from "../offline/sync-queue";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ RÖGZÍTŐ ŰRLAPJÁNAK LOGIKÁJA (task os-uzemeltetesi-naplo, S2c). KÜLÖN MODUL, mert a képernyőre nincs
 * komponens-teszt ebben az appban, és ami ott marad, azt csak eszközön, a helyszínen lehet kipróbálni.
 *
 * A SZABÁLYOK A SZERVER `operationsEntryErrors`-ÁNAK (`packages/types/src/operations-log-entry.ts`) TÜKRE: a telefon ugyanazt a
 * mondatot adja, amit a szerver adna, és az offline sorba csak olyan bejegyzés kerül, amelyet a szerver is elfogad (egy sorban
 * állva elutasított bejegyzés `conflict`-ba esne, és emberre várna). A kettő nem oszthat közös kódot (az app külön telepítésű), ezért
 * a mérés a tesztben áll: ugyanazok az esetek, ugyanazok a határok.
 *
 * AMIT A TELEFON TÖBBET TUD, mint a szerver: a KÖTELEZŐ FÉNYKÉP MEZŐ itt kikényszeríthető (a kép a rögzítéssel együtt indul), a
 * szerver ezt nem tudja (a kép a bejegyzés után, külön kérésben érkezik).
 */
export const ENTRY_LIMITS = {
  textMax: 2000,
  noteMax: 2000,
  participantsMax: 20,
  numberAbsMax: 1_000_000_000_000,
  maxDurationMs: 24 * 60 * 60 * 1000,
  photosPerFieldMax: 10,
} as const;

export interface OperationsEntryForm {
  /** A „Kezdés” gomb pillanata; `null`, amíg meg nem nyomták. */
  startedAt: Date | null;
  /** Szám mezőnél a beírt szöveg (tizedesvesszővel is), igen/nem mezőnél logikai, szövegnél szöveg. */
  values: Record<string, string | boolean>;
  participantIds: string[];
  anomaly: boolean;
  anomalyNote: string;
  internalNote: string;
  /** Fénykép mezőnként a kiválasztott képek. */
  photos: Record<string, PickedFile[]>;
}

export function emptyOperationsEntryForm(): OperationsEntryForm {
  return {
    startedAt: null,
    values: {},
    participantIds: [],
    anomaly: false,
    anomalyNote: "",
    internalNote: "",
    photos: {},
  };
}

const NUMBER_PATTERN = /^-?\d{1,12}(?:[.,]\d{1,6})?$/;

/** A beírt szöveg számmá; `null`, ha nem szám (az üres is). */
export function parseOperationsNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "" || !NUMBER_PATTERN.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && Math.abs(value) < ENTRY_LIMITS.numberAbsMax
    ? value
    : null;
}

export type OperationsEntryFormField =
  | `field:${string}`
  | "startedAt"
  | "anomalyNote"
  | "internalNote"
  | "participants";

export interface OperationsEntryPhotoToSend {
  fieldKey: string;
  file: PickedFile;
}

export type BuildOperationsEntryResult =
  | {
      ok: true;
      payload: CreateOperationsEntryInput & { queueTitle: string };
      /** A fénykép mezők képei: a rögzítés után, külön kérésben mennek. */
      photos: OperationsEntryPhotoToSend[];
      operationId: string;
    }
  | { ok: false; field: OperationsEntryFormField | null; message: string };

function filled(field: OperationsTemplateField, form: OperationsEntryForm) {
  const value = form.values[field.key];
  if (field.type === "PHOTO") return (form.photos[field.key] ?? []).length > 0;
  if (field.type === "BOOLEAN") return typeof value === "boolean";
  return typeof value === "string" && value.trim() !== "";
}

/**
 * A TELJES ŰRLAP EGY SZERVER-KÉSZ TÖRZZSÉ -- VAGY EGY MEGNEVEZETT HIBA.
 *
 * A `finishedAt` a „Kész” gomb pillanata (`now`), nem begépelt érték. Az igen/nem mező csak akkor kerül a törzsbe, ha a szerelő
 * állított rajta (a kapcsoló három állapota: nem érintett, igen, nem): az érintetlen mező hiány, nem „nem”. A szám és a szöveg csak
 * kitöltve megy. A `queueTitle` a sor listájának szól (a küldés előtt leválik), a `templateFieldKeys` a rögzítéskor LÁTOTT mezők.
 */
export function buildOperationsEntry(input: {
  template: OperationsTemplate;
  assetId: string;
  assetLabel: string;
  form: OperationsEntryForm;
  now: Date;
}): BuildOperationsEntryResult {
  const { template, form, now } = input;
  if (form.startedAt === null)
    return {
      ok: false,
      field: "startedAt",
      message:
        "Előbb nyomd meg a Kezdés gombot, hogy a rögzítés ideje pontos legyen.",
    };
  const started = form.startedAt.getTime();
  const finished = now.getTime();
  if (finished < started)
    return {
      ok: false,
      field: "startedAt",
      message: "A befejezés nem lehet a kezdés előtt.",
    };
  if (finished - started > ENTRY_LIMITS.maxDurationMs)
    return {
      ok: false,
      field: "startedAt",
      message:
        "Egy rögzítés legfeljebb 24 óráig tarthat. Töröld az időt, és kezdd újra.",
    };

  const values: Record<string, OperationsEntryValue> = {};
  for (const field of template.fields) {
    const name = `„${field.label}”`;
    if (field.required && !filled(field, form))
      return {
        ok: false,
        field: `field:${field.key}`,
        message: `${name}: kötelező kitölteni.`,
      };
    if (!filled(field, form)) continue;
    const raw = form.values[field.key];
    if (field.type === "NUMBER") {
      const number = parseOperationsNumber(String(raw));
      if (number === null)
        return {
          ok: false,
          field: `field:${field.key}`,
          message: `${name}: érvényes számot kell megadni.`,
        };
      values[field.key] = number;
    } else if (field.type === "BOOLEAN") {
      values[field.key] = raw === true;
    } else if (field.type === "TEXT") {
      const text = String(raw).trim();
      if (text.length > ENTRY_LIMITS.textMax)
        return {
          ok: false,
          field: `field:${field.key}`,
          message: `${name}: legfeljebb ${ENTRY_LIMITS.textMax} karakter lehet.`,
        };
      values[field.key] = text;
    } else if (
      (form.photos[field.key] ?? []).length > ENTRY_LIMITS.photosPerFieldMax
    ) {
      return {
        ok: false,
        field: `field:${field.key}`,
        message: `${name}: legfeljebb ${ENTRY_LIMITS.photosPerFieldMax} kép tölthető fel.`,
      };
    }
  }

  const anomalyNote = form.anomalyNote.trim();
  if (form.anomaly && anomalyNote === "")
    return {
      ok: false,
      field: "anomalyNote",
      message: "Rendellenességnél a leírás kötelező.",
    };
  if (anomalyNote.length > ENTRY_LIMITS.noteMax)
    return {
      ok: false,
      field: "anomalyNote",
      message: `A rendellenesség leírása legfeljebb ${ENTRY_LIMITS.noteMax} karakter lehet.`,
    };
  const internalNote = form.internalNote.trim();
  if (internalNote.length > ENTRY_LIMITS.noteMax)
    return {
      ok: false,
      field: "internalNote",
      message: `A belső megjegyzés legfeljebb ${ENTRY_LIMITS.noteMax} karakter lehet.`,
    };
  if (form.participantIds.length > ENTRY_LIMITS.participantsMax)
    return {
      ok: false,
      field: "participants",
      message: `Legfeljebb ${ENTRY_LIMITS.participantsMax} résztvevő adható meg.`,
    };

  const startedAt = form.startedAt.toISOString();
  const operationId = operationsEntryOperationId({
    assetId: input.assetId,
    templateId: template.id,
    startedAt,
  });
  return {
    ok: true,
    operationId,
    payload: {
      clientOperationId: operationId,
      templateId: template.id,
      assetId: input.assetId,
      templateFieldKeys: template.fields.map((field) => field.key),
      startedAt,
      finishedAt: now.toISOString(),
      participantIds: [...new Set(form.participantIds)],
      values,
      anomaly: form.anomaly,
      anomalyNote: form.anomaly ? anomalyNote : null,
      internalNote: internalNote === "" ? null : internalNote,
      queueTitle: `${template.name}: ${input.assetLabel}`,
    },
    photos: template.fields.flatMap((field) =>
      field.type === "PHOTO"
        ? (form.photos[field.key] ?? []).map((file) => ({
            fieldKey: field.key,
            file,
          }))
        : [],
    ),
  };
}
