import {
  VOCABULARY_V1_ROWS,
  buildVocabulary,
  normaliseText,
  splitWords,
  type Vocabulary,
  type VocabularyKind,
  type VocabularyRow,
} from "@acropora/knowledge-base";

/**
 * THE VOCABULARY'S VERSIONS (plan v4 K4; the vocabulary screen, Figma 3:425;
 * Balázs via acrobot 35807 and 35810).
 *
 * The approved vocabulary gates everything machine-made: the extraction (S3)
 * and the article's sentence check (7a) read ONLY the approved version. An
 * edit never touches it: the first edit copies it into a DRAFT of the next
 * version, every later edit changes that draft, and the draft becomes the
 * approved version only when the approver (Balázs, `knowledge.approve`)
 * approves it, whole.
 *
 * Version 1 lives in code (`VOCABULARY_V1_ROWS`, approved as the test base,
 * see `vocabulary.ts`); the database holds version 2 onwards. With no row in
 * the database, the approved version is the code's version 1.
 *
 * THE EDITOR'S WORKING COPY: the claim review may decide a field with a value
 * the draft holds (the "add to the vocabulary and accept" path), because that
 * is the editor's own decision, not a gate. It reads the draft as if approved
 * (`editorsWorkingCopy`); nothing else may. A claim verified on a draft key is
 * still checked by the approved vocabulary wherever a gate reads it, so until
 * the approval its sentences fail closed: over-caution, never a false fact.
 * Pure: no database, no clock.
 */
export interface StoredRow extends VocabularyRow {
  approvedAt?: Date | null;
  approvedById?: string | null;
}

export interface VocabularyVersions {
  approved: {
    version: number;
    /** CODE: version 1 from `vocabulary.ts`; DATABASE: an approved database version. */
    origin: "CODE" | "DATABASE";
    rows: StoredRow[];
    approvedAt: Date | null;
    approvedById: string | null;
  };
  draft: { version: number; rows: StoredRow[] } | null;
}

const live = (r: VocabularyRow) => r.status !== "RETIRED";

export function versionsOf(stored: readonly StoredRow[]): VocabularyVersions {
  const byVersion = new Map<number, StoredRow[]>();
  for (const r of stored.filter(live))
    byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r]);
  const versions = [...byVersion.keys()].sort((a, b) => b - a);
  const approvedVersion = versions.find((v) =>
    byVersion.get(v)!.every((r) => r.status === "APPROVED"),
  );
  const approved: VocabularyVersions["approved"] =
    approvedVersion === undefined
      ? {
          version: 1,
          origin: "CODE",
          rows: [...VOCABULARY_V1_ROWS],
          approvedAt: null,
          approvedById: null,
        }
      : {
          version: approvedVersion,
          origin: "DATABASE",
          rows: byVersion.get(approvedVersion)!,
          approvedAt: byVersion.get(approvedVersion)![0]!.approvedAt ?? null,
          approvedById:
            byVersion.get(approvedVersion)![0]!.approvedById ?? null,
        };
  const draftVersion = versions.find(
    (v) =>
      v > approved.version &&
      byVersion.get(v)!.some((r) => r.status === "DRAFT"),
  );
  return {
    approved,
    draft:
      draftVersion === undefined
        ? null
        : { version: draftVersion, rows: byVersion.get(draftVersion)! },
  };
}

/** The rows the editor works on: the draft when there is one, else the approved. */
export function workingRows(v: VocabularyVersions): StoredRow[] {
  return v.draft?.rows ?? v.approved.rows;
}

/** The approved vocabulary: the only one a gate may read. */
export function approvedVocabulary(v: VocabularyVersions): Vocabulary {
  return buildVocabulary(v.approved.rows);
}

/** The draft read as if approved: for the editor's review and the probe only. */
export function editorsWorkingCopy(rows: readonly VocabularyRow[]): Vocabulary {
  return buildVocabulary(
    rows.map((r) =>
      r.status === "RETIRED" ? r : { ...r, status: "APPROVED" as const },
    ),
  );
}

/** A draft row copied from the base, or a new row: the shape the next version stores. */
export function draftCopy(rows: readonly VocabularyRow[], version: number) {
  return rows.filter(live).map((r): VocabularyRow => ({
    kind: r.kind,
    key: r.key,
    forms: [...r.forms],
    exactMatch: r.exactMatch === true,
    parentKey: r.parentKey ?? null,
    rank: r.rank ?? null,
    note: r.note ?? null,
    status: "DRAFT",
    version,
  }));
}

export interface RowChange {
  kind: VocabularyKind;
  key: string;
  change: "ADDED" | "CHANGED" | "REMOVED";
  /** CHANGED: which columns. */
  fields: string[];
}

const COMPARED = ["forms", "exactMatch", "parentKey", "rank", "note"] as const;

/** What the draft changes against the approved version: what the approver approves. */
export function diffRows(
  approved: readonly VocabularyRow[],
  draft: readonly VocabularyRow[],
): RowChange[] {
  const id = (r: VocabularyRow) => `${r.kind}/${r.key}`;
  const before = new Map(approved.filter(live).map((r) => [id(r), r]));
  const after = new Map(draft.filter(live).map((r) => [id(r), r]));
  const norm = (r: VocabularyRow, f: (typeof COMPARED)[number]) =>
    JSON.stringify(f === "exactMatch" ? r.exactMatch === true : (r[f] ?? null));
  const changes: RowChange[] = [];
  for (const [k, r] of after) {
    const old = before.get(k);
    if (!old) {
      changes.push({ kind: r.kind, key: r.key, change: "ADDED", fields: [] });
      continue;
    }
    const fields = COMPARED.filter((f) => norm(old, f) !== norm(r, f));
    if (fields.length)
      changes.push({ kind: r.kind, key: r.key, change: "CHANGED", fields });
  }
  for (const [k, r] of before)
    if (!after.has(k))
      changes.push({ kind: r.kind, key: r.key, change: "REMOVED", fields: [] });
  return changes;
}

export class VocabularyInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VocabularyInputError";
  }
}

/** The kinds a new key may be added to: the others have closed key lists (7a). */
export const ADDABLE_KINDS = ["TAXON", "EFFECT"] as const;
export type AddableKind = (typeof ADDABLE_KINDS)[number];

const KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
export const MAX_FORMS = 20;
export const MAX_FORM = 80;
export const MAX_NOTE = 500;

/** A key from a written name: "Pocillopora verrucosa" -> POCILLOPORA_VERRUCOSA. */
export function keyOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "K_$1")
    .slice(0, 64);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function formsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FORMS)
    throw new VocabularyInputError(
      "BAD_FORMS",
      `forms: 1 to ${MAX_FORMS} written forms`,
    );
  const forms = value.map((f) => (typeof f === "string" ? f.trim() : ""));
  if (
    forms.some(
      (f) =>
        !f || f.length > MAX_FORM || splitWords(normaliseText(f)).length === 0,
    )
  )
    throw new VocabularyInputError(
      "BAD_FORMS",
      `forms: each a word or words, at most ${MAX_FORM} characters`,
    );
  // one form once: "Acropora" and "acropora" are the same form
  const seen = new Set<string>();
  return forms.filter((f) => {
    const k = splitWords(normaliseText(f)).join(" ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function noteOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > MAX_NOTE)
    throw new VocabularyInputError(
      "BAD_NOTE",
      `note: at most ${MAX_NOTE} characters`,
    );
  return value.trim() || null;
}

export interface NewEntry {
  kind: AddableKind;
  key: string;
  forms: string[];
  parentKey: string | null;
  rank: "GROUP" | "GENUS" | "SPECIES" | null;
  note: string | null;
}

/**
 * A new entry, checked against the rows it joins. A taxon needs its rank and,
 * below a group, its parent; its key is derived from its first form unless
 * given. An effect's forms are the Hungarian words a sentence uses for it, so
 * its first form is also its label on every screen.
 */
export function parseNewEntry(
  body: unknown,
  rows: readonly VocabularyRow[],
): NewEntry {
  if (!isRecord(body))
    throw new VocabularyInputError("BAD_BODY", "an entry object is required");
  if (!(ADDABLE_KINDS as readonly unknown[]).includes(body.kind))
    throw new VocabularyInputError(
      "BAD_KIND",
      `kind: one of ${ADDABLE_KINDS.join(", ")}`,
    );
  const kind = body.kind as AddableKind;
  const forms = formsOf(body.forms);
  const key =
    typeof body.key === "string" && body.key.trim()
      ? body.key.trim()
      : keyOf(forms[0]!);
  if (!KEY.test(key))
    throw new VocabularyInputError(
      "BAD_KEY",
      "key: upper-case letters, digits and _, at most 64",
    );
  if (rows.some((r) => r.kind === kind && r.key === key && live(r)))
    throw new VocabularyInputError(
      "KEY_TAKEN",
      `${kind}/${key} is already in the vocabulary`,
    );
  let parentKey: string | null = null;
  let rank: NewEntry["rank"] = null;
  if (kind === "TAXON") {
    if (!["GROUP", "GENUS", "SPECIES"].includes(body.rank as string))
      throw new VocabularyInputError(
        "BAD_RANK",
        "rank: GROUP, GENUS or SPECIES",
      );
    rank = body.rank as NewEntry["rank"];
    parentKey =
      typeof body.parentKey === "string" && body.parentKey
        ? body.parentKey
        : null;
    if (rank !== "GROUP" && parentKey === null)
      throw new VocabularyInputError(
        "NO_PARENT",
        "a genus or a species needs its parent",
      );
    if (
      parentKey !== null &&
      !rows.some((r) => r.kind === "TAXON" && r.key === parentKey && live(r))
    )
      throw new VocabularyInputError(
        "UNKNOWN_PARENT",
        `parent ${parentKey} is not a taxon of the vocabulary`,
      );
  }
  return { kind, key, forms, parentKey, rank, note: noteOf(body.note) };
}

export interface EntryEdit {
  forms?: string[];
  parentKey?: string | null;
  note?: string | null;
}

export function parseEntryEdit(
  body: unknown,
  row: VocabularyRow,
  rows: readonly VocabularyRow[],
): EntryEdit {
  if (!isRecord(body))
    throw new VocabularyInputError("BAD_BODY", "an edit object is required");
  const edit: EntryEdit = {};
  if (body.forms !== undefined) edit.forms = formsOf(body.forms);
  if (body.note !== undefined) edit.note = noteOf(body.note);
  if (body.parentKey !== undefined) {
    if (row.kind !== "TAXON")
      throw new VocabularyInputError(
        "NOT_A_TAXON",
        "only a taxon has a parent",
      );
    const parent =
      typeof body.parentKey === "string" && body.parentKey
        ? body.parentKey
        : null;
    if (parent === null && row.rank !== "GROUP")
      throw new VocabularyInputError(
        "NO_PARENT",
        "a genus or a species needs its parent",
      );
    if (
      parent !== null &&
      !rows.some((r) => r.kind === "TAXON" && r.key === parent && live(r))
    )
      throw new VocabularyInputError(
        "UNKNOWN_PARENT",
        `parent ${parent} is not a taxon of the vocabulary`,
      );
    edit.parentKey = parent;
  }
  if (Object.keys(edit).length === 0)
    throw new VocabularyInputError("NOTHING_TO_CHANGE", "no change given");
  return edit;
}

/**
 * The rows with the change applied, built the way a gate would build them:
 * a form under two keys, a parent cycle or an unknown parent is refused here,
 * before anything is written.
 */
export function checkedRows(rows: readonly VocabularyRow[]): VocabularyRow[] {
  try {
    editorsWorkingCopy(rows);
  } catch (error) {
    throw new VocabularyInputError(
      "VOCABULARY_INVALID",
      (error as Error).message,
    );
  }
  return [...rows];
}

/** A row's label on the screens: its first form, a short group name in capitals. */
export function labelOf(row: Pick<VocabularyRow, "kind" | "key" | "forms">) {
  const first = row.forms[0];
  if (first === undefined) return row.key;
  if (row.kind === "TAXON" && first.length <= 3) return first.toUpperCase();
  return first.charAt(0).toLocaleUpperCase("hu-HU") + first.slice(1);
}
