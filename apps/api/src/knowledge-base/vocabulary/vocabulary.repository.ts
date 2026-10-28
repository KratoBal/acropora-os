import { Prisma, prisma } from "@acropora/database";
import {
  recogniseSentence,
  type KindShadow,
  type SentenceParts,
  type Vocabulary,
  type VocabularyKind,
  type VocabularyRow,
} from "@acropora/knowledge-base";

import {
  VocabularyInputError,
  addedShadows,
  approvedVocabulary,
  checkedRows,
  diffRows,
  draftCopy,
  draftFingerprint,
  editorsWorkingCopy,
  labelOf,
  parseEntryEdit,
  versionsOf,
  workingRows,
  type NewEntry,
  type RowChange,
  type StoredRow,
  type VocabularyVersions,
} from "./vocabulary-versions.js";

type Tx = Prisma.TransactionClient;

export class VocabularyConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocabularyConflict";
  }
}

export class VocabularyEntryNotFound extends Error {
  constructor(id: string) {
    super(`no vocabulary entry ${id}`);
    this.name = "VocabularyEntryNotFound";
  }
}

export interface VocabularyEntryView {
  kind: VocabularyKind;
  key: string;
  label: string;
  forms: string[];
  exactMatch: boolean;
  parentKey: string | null;
  rank: string | null;
  note: string | null;
}

export interface VocabularyState {
  approved: {
    version: number;
    origin: "CODE" | "DATABASE";
    approvedAt: string | null;
    approvedBy: string | null;
  };
  /** The version being edited, with what it changes; null when nothing is being edited. */
  draft: {
    version: number;
    changes: RowChange[];
    /** What the approver sends back: the draft exactly as they saw it. */
    fingerprint: string;
    /** Cross-kind pairs the draft adds; null when the draft does not build. */
    newShadows: KindShadow[] | null;
  } | null;
  /** The rows the editor works on: the draft's, or the approved ones. */
  entries: VocabularyEntryView[];
}

const ROW_SELECT = {
  kind: true,
  key: true,
  forms: true,
  exactMatch: true,
  parentKey: true,
  rank: true,
  note: true,
  status: true,
  version: true,
  approvedAt: true,
  approvedById: true,
} as const;

const view = (r: VocabularyRow): VocabularyEntryView => ({
  kind: r.kind,
  key: r.key,
  label: labelOf(r),
  forms: [...r.forms],
  exactMatch: r.exactMatch === true,
  parentKey: r.parentKey ?? null,
  rank: r.rank ?? null,
  note: r.note ?? null,
});

/**
 * THE VOCABULARY IN THE DATABASE (`KnowledgeVocabularyEntry`). Every write
 * goes to the draft of the next version and writes its AuditLog row in the
 * same transaction; only `approve` makes a version approved. See
 * `vocabulary-versions.ts` for the rules.
 */
export class VocabularyRepository {
  async versions(tx: Tx | typeof prisma = prisma): Promise<VocabularyVersions> {
    const rows = await tx.knowledgeVocabularyEntry.findMany({
      select: ROW_SELECT,
      orderBy: [{ version: "asc" }, { kind: "asc" }, { key: "asc" }],
    });
    return versionsOf(rows as StoredRow[]);
  }

  /** The approved vocabulary: what the extraction and every gate read. */
  async approvedVocabulary(): Promise<Vocabulary> {
    return approvedVocabulary(await this.versions());
  }

  async state(): Promise<VocabularyState> {
    const v = await this.versions();
    const approvedBy = v.approved.approvedById
      ? ((
          await prisma.user.findUnique({
            where: { id: v.approved.approvedById },
            select: { displayName: true },
          })
        )?.displayName ?? null)
      : null;
    return {
      approved: {
        version: v.approved.version,
        origin: v.approved.origin,
        approvedAt: v.approved.approvedAt?.toISOString() ?? null,
        approvedBy,
      },
      draft: v.draft
        ? {
            version: v.draft.version,
            changes: diffRows(v.approved.rows, v.draft.rows),
            fingerprint: draftFingerprint(v.draft.rows),
            newShadows: addedShadows(v.approved.rows, v.draft.rows),
          }
        : null,
      entries: workingRows(v).map(view),
    };
  }

  /** What the vocabulary recognises in a Hungarian sentence: the approved, or the draft. */
  async probe(
    sentence: string,
    use: "APPROVED" | "DRAFT",
  ): Promise<{ version: number; parts: SentenceParts }> {
    const v = await this.versions();
    if (use === "DRAFT" && v.draft)
      return {
        version: v.draft.version,
        parts: recogniseSentence(sentence, editorsWorkingCopy(v.draft.rows)),
      };
    return {
      version: v.approved.version,
      parts: recogniseSentence(sentence, approvedVocabulary(v)),
    };
  }

  /**
   * The draft's version, created when there is none: the approved rows copied
   * as DRAFT rows of the next version. Two editors creating it at once meet
   * on the (kind, key, version) key: the second one is told to reload.
   */
  async ensureDraft(tx: Tx): Promise<{ version: number; rows: StoredRow[] }> {
    const v = await this.versions(tx);
    if (v.draft) return v.draft;
    const version = v.approved.version + 1;
    const rows = draftCopy(v.approved.rows, version);
    try {
      await tx.knowledgeVocabularyEntry.createMany({
        data: rows.map((r) => ({
          kind: r.kind,
          key: r.key,
          forms: [...r.forms],
          exactMatch: r.exactMatch === true,
          parentKey: r.parentKey ?? null,
          rank: r.rank ?? null,
          note: r.note ?? null,
          status: "DRAFT" as const,
          version,
        })),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new VocabularyConflict(
          "the vocabulary draft was created meanwhile",
        );
      throw error;
    }
    return { version, rows };
  }

  /**
   * A new key into the draft, in the caller's transaction (the claim review
   * adds one and decides the field with it in one transaction).
   */
  async addEntryIn(
    tx: Tx,
    entry: NewEntry,
    actorUserId: string,
    context: Record<string, unknown> = {},
  ): Promise<{ version: number; rows: VocabularyRow[] }> {
    const draft = await this.ensureDraft(tx);
    if (draft.rows.some((r) => r.kind === entry.kind && r.key === entry.key))
      throw new VocabularyInputError(
        "KEY_TAKEN",
        `${entry.kind}/${entry.key} is already in the vocabulary`,
      );
    const row: VocabularyRow = {
      kind: entry.kind,
      key: entry.key,
      forms: entry.forms,
      exactMatch: false,
      parentKey: entry.parentKey,
      rank: entry.rank,
      note: entry.note,
      status: "DRAFT",
      version: draft.version,
    };
    const rows = checkedRows([...draft.rows, row]);
    await tx.knowledgeVocabularyEntry.create({
      data: {
        kind: row.kind,
        key: row.key,
        forms: [...row.forms],
        exactMatch: false,
        parentKey: row.parentKey ?? null,
        rank: row.rank ?? null,
        note: row.note ?? null,
        status: "DRAFT",
        version: draft.version,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "KNOWLEDGE_VOCABULARY_ENTRY_ADDED",
        entityType: "KnowledgeVocabularyEntry",
        entityId: `${row.kind}/${row.key}/${draft.version}`,
        metadata: {
          after: view(row),
          version: draft.version,
          ...context,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return { version: draft.version, rows };
  }

  async addEntry(
    entry: NewEntry,
    actorUserId: string,
  ): Promise<VocabularyState> {
    await prisma.$transaction((tx) => this.addEntryIn(tx, entry, actorUserId));
    return this.state();
  }

  /** A draft row's forms, parent or note; the approved row stays as it is. */
  async editEntry(
    kind: VocabularyKind,
    key: string,
    body: unknown,
    actorUserId: string,
  ): Promise<VocabularyState> {
    await prisma.$transaction(async (tx) => {
      const draft = await this.ensureDraft(tx);
      const row = draft.rows.find((r) => r.kind === kind && r.key === key);
      if (!row) throw new VocabularyEntryNotFound(`${kind}/${key}`);
      const edit = parseEntryEdit(body, row, draft.rows);
      const changed: VocabularyRow = {
        ...row,
        ...(edit.forms ? { forms: edit.forms } : {}),
        ...(edit.parentKey !== undefined ? { parentKey: edit.parentKey } : {}),
        ...(edit.note !== undefined ? { note: edit.note } : {}),
      };
      checkedRows(draft.rows.map((r) => (r === row ? changed : r)));
      const { count } = await tx.knowledgeVocabularyEntry.updateMany({
        where: { kind, key, version: draft.version, status: "DRAFT" },
        data: {
          ...(edit.forms ? { forms: edit.forms } : {}),
          ...(edit.parentKey !== undefined
            ? { parentKey: edit.parentKey }
            : {}),
          ...(edit.note !== undefined ? { note: edit.note } : {}),
        },
      });
      if (count !== 1)
        throw new VocabularyConflict("the draft changed meanwhile");
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_VOCABULARY_ENTRY_CHANGED",
          entityType: "KnowledgeVocabularyEntry",
          entityId: `${kind}/${key}/${draft.version}`,
          metadata: {
            before: view(row),
            after: view(changed),
            version: draft.version,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return this.state();
  }

  /**
   * The draft becomes the approved version, whole. The approver names the
   * version AND the fingerprint they saw: the version number stays while the
   * draft is edited, so a row added after the screen was opened (on the
   * vocabulary screen, or from the review's add path) changes only the
   * fingerprint, and the approval is refused instead of approving it blind.
   */
  async approve(
    version: number,
    fingerprint: string,
    actorUserId: string,
  ): Promise<VocabularyState> {
    await prisma.$transaction(async (tx) => {
      const v = await this.versions(tx);
      if (!v.draft)
        throw new VocabularyConflict("there is no draft to approve");
      if (v.draft.version !== version)
        throw new VocabularyConflict(
          `the draft is version ${v.draft.version}, not ${version}`,
        );
      if (draftFingerprint(v.draft.rows) !== fingerprint)
        throw new VocabularyConflict(
          "the draft changed since it was opened: review it again",
        );
      const changes = diffRows(v.approved.rows, v.draft.rows);
      if (changes.length === 0)
        throw new VocabularyInputError(
          "NO_CHANGE",
          "the draft changes nothing against the approved version",
        );
      checkedRows(v.draft.rows);
      const now = new Date();
      const { count } = await tx.knowledgeVocabularyEntry.updateMany({
        where: { version, status: "DRAFT" },
        data: {
          status: "APPROVED",
          approvedById: actorUserId,
          approvedAt: now,
        },
      });
      if (count !== v.draft.rows.length)
        throw new VocabularyConflict("the draft changed meanwhile");
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_VOCABULARY_APPROVED",
          entityType: "KnowledgeVocabulary",
          entityId: String(version),
          metadata: {
            before: { version: v.approved.version, origin: v.approved.origin },
            after: { version, rows: count },
            changes,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return this.state();
  }
}
