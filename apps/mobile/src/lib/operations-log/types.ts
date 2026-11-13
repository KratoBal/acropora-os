/**
 * AZ ÜZEMELTETÉSI NAPLÓ TÍPUSAI, A TELEFON SAJÁT MÁSOLATA (task os-uzemeltetesi-naplo, S2c). KÜLÖN, IMPORT NÉLKÜLI FÁJL, hogy a tiszta
 * logika (`entry-form.ts`) és a hozzá tartozó tesztek fordulhassanak a hálózati kliens (`api/client.ts`, `@/` aliasok) nélkül: a
 * teszt-fordító nem ismeri az aliast, és egy típus-importon át a kliens is belekerülne a fordítási halmazba. A szerver oldalán az
 * `apps/api/src/operations-log/` és a `packages/types/src/operations-log*.ts` áll (lásd `docs/MOBILE-DEVELOPMENT.md`).
 */

export type OperationsTaskFrequency = "DAILY" | "WEEKLY" | "OCCASIONAL";
export type OperationsFieldType = "NUMBER" | "BOOLEAN" | "TEXT" | "PHOTO";
export type OperationsMeterRole = "BEFORE" | "AFTER";

export interface OperationsTemplateField {
  id: string;
  /** A mező stabil azonosítója a sablonon belül: a bejegyzés az értéket ezzel küldi. */
  key: string;
  label: string;
  type: OperationsFieldType;
  unit: string | null;
  required: boolean;
  meterRole: OperationsMeterRole | null;
  sortOrder: number;
}

export interface OperationsTemplate {
  id: string;
  name: string;
  description: string | null;
  frequency: OperationsTaskFrequency;
  /** Az AKTÍV mezők, a megadott sorrendben. */
  fields: OperationsTemplateField[];
  /** A sablon utolsó módosítása: az offline gyorsítótár ebből látja, hogy elavult-e. */
  updatedAt: string;
}

export interface OperationsColleague {
  id: string;
  name: string;
}

export type OperationsEntryValue = number | boolean | string;

export interface CreateOperationsEntryInput {
  /** A rögzítés idempotencia-kulcsa: az újraküldés ugyanazt a bejegyzést adja vissza. */
  clientOperationId: string;
  templateId: string;
  assetId: string;
  /** A mezők kulcsai, amelyeket a telefon a rögzítéskor LÁTOTT: a kötelező-ellenőrzés csak ezekre szól. */
  templateFieldKeys: string[];
  startedAt: string;
  finishedAt: string;
  /** A rögzítőn kívüli résztvevők (a rögzítő mindig résztvevő). */
  participantIds?: string[];
  /** Mező-kulcs szerint; a fénykép mezők képei külön jönnek. */
  values: Record<string, OperationsEntryValue>;
  anomaly?: boolean;
  anomalyNote?: string | null;
  internalNote?: string | null;
}

export interface OperationsEntryCreated {
  id: string;
}

export interface CreateOperationsEntryResponse {
  entry: OperationsEntryCreated;
  /** Hamis: az újraküldés a már rögzített bejegyzést adta vissza. */
  created: boolean;
}

export interface UploadOperationsPhotoResponse {
  photo: { id: string; fieldKey: string };
  created: boolean;
}
