import { Prisma, prisma } from "@acropora/database";
import type {
  Applicability,
  CitedClaim,
  Environment,
  EvidenceLevel,
  StudyType,
} from "@acropora/knowledge-base";

import { CLAIM_ON_INCLUDED_SOURCE } from "../included-source.js";
import { workingRows } from "../vocabulary/vocabulary-versions.js";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository.js";
import {
  claimEvidenceLevel,
  claimScope,
  claimTitle,
  labelsFrom,
  quantityLabel,
  type ClaimLayer,
  type Labels,
  type LevelRow,
} from "./claim-store.js";

export const STORE_LIMIT = 500;

interface Level {
  level: EvidenceLevel | null;
  reasons: string[];
  rulesVersion: string;
}

interface SourceRef {
  id: string;
  title: string;
  year: number | null;
  retracted: boolean;
}

export interface ClaimStoreItem {
  id: string;
  layer: ClaimLayer;
  status: string;
  /** Derived from the normalized fields: the claim has no text column. */
  title: string;
  effect: { key: string; label: string } | null;
  direction: string | null;
  quantity: string | null;
  species: { key: string; label: string }[];
  /** The supporting sources, distinct, in evidence order. */
  sources: SourceRef[];
  evidenceLevel: Level;
  /** Whether a supporting source reports a control group. */
  controlled: boolean | null;
  /** The largest sample size the evidence reports. */
  sampleSize: { value: number; unit: string | null } | null;
  revision: number;
  updatedAt: string;
}

export interface ClaimStoreList {
  claims: ClaimStoreItem[];
  total: number;
  /** VERIFIED claims per layer, the filter's counts. */
  layers: Record<ClaimLayer, number>;
}

export interface ClaimEvidenceView {
  id: string;
  stance: string;
  source: SourceRef & {
    doi: string | null;
    url: string | null;
    studyType: string | null;
    controlled: boolean | null;
  };
  passage: { text: string; locator: string; verifiedVerbatim: boolean };
  species: { key: string; label: string }[];
  environment: { key: string; label: string } | null;
  sampleSize: { value: number; unit: string | null } | null;
  uncertainty: string | null;
  conditions: string | null;
  applicability: { value: string; reason: string | null } | null;
  /** The decided field anchors: the editor's value where corrected. */
  anchors: {
    field: string;
    value: string | null;
    decision: string;
    passage: { text: string; locator: string };
  }[];
}

export interface ClaimRelationView {
  kind: string;
  note: string | null;
  claim: { id: string; title: string; status: string; layer: string };
}

export interface ClaimStoreDetail extends Omit<
  ClaimStoreItem,
  "sources" | "controlled" | "sampleSize"
> {
  evidence: ClaimEvidenceView[];
  relationsFrom: ClaimRelationView[];
  relationsTo: ClaimRelationView[];
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
}

export class ClaimStoreNotFound extends Error {
  constructor(id: string) {
    super(`no claim ${id}`);
    this.name = "ClaimStoreNotFound";
  }
}

const SOURCE_SELECT = {
  id: true,
  title: true,
  year: true,
  doi: true,
  url: true,
  studyType: true,
  controlled: true,
  versions: { select: { versionKind: true } },
} satisfies Prisma.KnowledgeSourceSelect;

const EVIDENCE_SELECT = {
  id: true,
  stance: true,
  species: true,
  environment: true,
  sampleSize: true,
  sampleUnit: true,
  uncertainty: true,
  conditions: true,
  homeReefApplicability: true,
  applicabilityReason: true,
  passage: {
    select: {
      text: true,
      locator: true,
      verifiedVerbatimAt: true,
      sourceVersion: { select: { source: { select: SOURCE_SELECT } } },
    },
  },
} satisfies Prisma.KnowledgeClaimEvidenceSelect;

const CORE_SELECT = {
  id: true,
  layer: true,
  status: true,
  effect: true,
  direction: true,
  originalMin: true,
  originalMax: true,
  originalUnit: true,
  chemicalBasis: true,
  normalizedMinMgL: true,
  normalizedMaxMgL: true,
  revision: true,
  updatedAt: true,
} satisfies Prisma.KnowledgeClaimSelect;

/** The other side of a CONTRADICTS relation: its supporting sources count against. */
const CONTRA_SELECT = {
  evidence: {
    where: { stance: "SUPPORTS" as const },
    select: {
      passage: {
        select: {
          sourceVersion: {
            select: {
              sourceId: true,
              source: {
                select: { versions: { select: { versionKind: true } } },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.KnowledgeClaimSelect;

const RELATED_SELECT = {
  ...CORE_SELECT,
  ...CONTRA_SELECT,
} satisfies Prisma.KnowledgeClaimSelect;

/** The list reads only the CONTRADICTS relations (the level); the detail reads all. */
function relationsSelect(contradictsOnly: boolean) {
  const where = contradictsOnly ? { kind: "CONTRADICTS" as const } : {};
  const orderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  return {
    relationsFrom: {
      where,
      orderBy,
      select: { kind: true, note: true, toClaim: { select: RELATED_SELECT } },
    },
    relationsTo: {
      where,
      orderBy,
      select: { kind: true, note: true, fromClaim: { select: RELATED_SELECT } },
    },
  } satisfies Prisma.KnowledgeClaimSelect;
}

const LIST_SELECT = {
  ...CORE_SELECT,
  evidence: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: EVIDENCE_SELECT,
  },
  ...relationsSelect(true),
} satisfies Prisma.KnowledgeClaimSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  ...relationsSelect(false),
  validFrom: true,
  validUntil: true,
  createdAt: true,
  evidence: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      ...EVIDENCE_SELECT,
      anchors: {
        where: { decision: { in: ["ACCEPTED", "CORRECTED"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          field: true,
          normalizedValue: true,
          correctedValue: true,
          decision: true,
          passage: { select: { text: true, locator: true } },
        },
      },
    },
  },
} satisfies Prisma.KnowledgeClaimSelect;

type Core = Prisma.KnowledgeClaimGetPayload<{ select: typeof CORE_SELECT }>;
type ListClaim = Prisma.KnowledgeClaimGetPayload<{
  select: typeof LIST_SELECT;
}>;
type Evidence = ListClaim["evidence"][number];

const text = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());
const conditionsText = (v: Prisma.JsonValue) =>
  v && typeof v === "object" && !Array.isArray(v) && typeof v.text === "string"
    ? v.text
    : null;

function quantityOf(c: Core) {
  return {
    min: text(c.originalMin),
    max: text(c.originalMax),
    unit: c.originalUnit,
    basis: c.chemicalBasis,
  };
}

function titleOf(c: Core, labels: Labels) {
  return claimTitle(c.effect, c.direction, quantityOf(c), labels);
}

function sourceOf(e: Evidence) {
  return e.passage.sourceVersion.source;
}

function sourceRef(s: ReturnType<typeof sourceOf>): SourceRef {
  return {
    id: s.id,
    title: s.title,
    year: s.year,
    retracted: s.versions.some((v) => v.versionKind === "RETRACTION"),
  };
}

function levelOf(c: ListClaim): Level {
  const rows: LevelRow[] = c.evidence.map((e) => ({
    sourceId: sourceOf(e).id,
    stance: e.stance,
    studyType: sourceOf(e).studyType as StudyType | null,
    controlled: sourceOf(e).controlled,
    sampleSize: e.sampleSize,
    retracted: sourceRef(sourceOf(e)).retracted,
  }));
  // only a VERIFIED claim contradicts, and only through a source not retracted
  // (barracuda, #1867 notes 1 and 2)
  const contra = [
    ...c.relationsFrom.map((r) => ({ kind: r.kind, other: r.toClaim })),
    ...c.relationsTo.map((r) => ({ kind: r.kind, other: r.fromClaim })),
  ]
    .filter((r) => r.kind === "CONTRADICTS" && r.other.status === "VERIFIED")
    .flatMap(({ other }) =>
      other.evidence
        .filter(
          (e) =>
            !e.passage.sourceVersion.source.versions.some(
              (v) => v.versionKind === "RETRACTION",
            ),
        )
        .map((e) => e.passage.sourceVersion.sourceId),
    );
  return claimEvidenceLevel(rows, contra);
}

function coreOf(c: ListClaim, labels: Labels) {
  return {
    id: c.id,
    layer: c.layer,
    status: c.status,
    title: titleOf(c, labels),
    effect: c.effect
      ? { key: c.effect, label: labels("EFFECT", c.effect) }
      : null,
    direction: c.direction,
    quantity: quantityLabel(quantityOf(c)),
    species: [...new Set(c.evidence.flatMap((e) => e.species))].map((key) => ({
      key,
      label: labels("TAXON", key),
    })),
    evidenceLevel: levelOf(c),
    revision: c.revision,
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function storeItem(c: ListClaim, labels: Labels): ClaimStoreItem {
  const supporting = c.evidence.filter((e) => e.stance === "SUPPORTS");
  const sources = new Map<string, SourceRef>();
  for (const e of supporting)
    sources.set(sourceOf(e).id, sourceRef(sourceOf(e)));
  const controls = supporting.map((e) => sourceOf(e).controlled);
  const sample = supporting
    .filter((e) => e.sampleSize !== null)
    .sort((a, b) => b.sampleSize! - a.sampleSize!)[0];
  return {
    ...coreOf(c, labels),
    sources: [...sources.values()],
    controlled: controls.includes(true)
      ? true
      : controls.includes(false)
        ? false
        : null,
    sampleSize: sample
      ? { value: sample.sampleSize!, unit: sample.sampleUnit }
      : null,
  };
}

const decimal = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/**
 * The claims an article cites, by id, with the scope the sentence check
 * reads (`claimScope`). A claim that is not VERIFIED comes back with its
 * status, and the report refuses it before the scope is read.
 */
export async function citedClaims(
  ids: readonly string[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, CitedClaim>> {
  if (ids.length === 0) return new Map();
  const rows = await client.knowledgeClaim.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: LIST_SELECT,
  });
  return new Map(
    rows.map((c) => [
      c.id,
      {
        status: c.status,
        scope: claimScope({
          rows: c.evidence.map((e) => ({
            stance: e.stance,
            species: e.species,
            environment: e.environment as Environment | null,
            applicability: e.homeReefApplicability as Applicability | null,
            retracted: sourceRef(sourceOf(e)).retracted,
          })),
          normalizedMinMgL: decimal(c.normalizedMinMgL),
          normalizedMaxMgL: decimal(c.normalizedMaxMgL),
          effect: c.effect,
          direction: c.direction,
          evidenceLevel: levelOf(c).level,
        }),
      },
    ]),
  );
}

export class ClaimStoreRepository {
  private readonly vocabulary = new VocabularyRepository();

  private async labels(): Promise<Labels> {
    const v = await this.vocabulary.versions();
    return labelsFrom(v.approved.rows, workingRows(v));
  }

  /**
   * The VERIFIED claims on included sources, newest change first, with the
   * per-layer counts for the filter.
   */
  async list(layer: ClaimLayer | null): Promise<ClaimStoreList> {
    const where = {
      status: "VERIFIED" as const,
      ...CLAIM_ON_INCLUDED_SOURCE,
    };
    const [rows, total, groups] = await prisma.$transaction([
      prisma.knowledgeClaim.findMany({
        where: layer ? { ...where, layer } : where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: LIST_SELECT,
        take: STORE_LIMIT,
      }),
      prisma.knowledgeClaim.count({
        where: layer ? { ...where, layer } : where,
      }),
      prisma.knowledgeClaim.groupBy({
        by: ["layer"],
        where,
        orderBy: { layer: "asc" },
        _count: { _all: true },
      }),
    ]);
    const labels = await this.labels();
    const layers: Record<ClaimLayer, number> = {
      SCIENTIFIC: 0,
      HOBBY_EXPERIENCE: 0,
      MANUFACTURER: 0,
      OWN_CONCLUSION: 0,
    };
    for (const g of groups) layers[g.layer] = g._count._all;
    return { claims: rows.map((c) => storeItem(c, labels)), total, layers };
  }

  /** One claim with every evidence row, its passage and anchors, and its relations. */
  async detail(claimId: string): Promise<ClaimStoreDetail> {
    const c = await prisma.knowledgeClaim.findUnique({
      where: { id: claimId },
      select: DETAIL_SELECT,
    });
    if (!c) throw new ClaimStoreNotFound(claimId);
    const labels = await this.labels();
    const relation = (kind: string, note: string | null, other: Core) => ({
      kind,
      note,
      claim: {
        id: other.id,
        title: titleOf(other, labels),
        status: other.status,
        layer: other.layer,
      },
    });
    return {
      ...coreOf(c, labels),
      evidence: c.evidence.map((e) => ({
        id: e.id,
        stance: e.stance,
        source: {
          ...sourceRef(sourceOf(e)),
          doi: sourceOf(e).doi,
          url: sourceOf(e).url,
          studyType: sourceOf(e).studyType,
          controlled: sourceOf(e).controlled,
        },
        passage: {
          text: e.passage.text,
          locator: e.passage.locator,
          verifiedVerbatim: e.passage.verifiedVerbatimAt !== null,
        },
        species: e.species.map((key) => ({ key, label: labels("TAXON", key) })),
        environment: e.environment
          ? { key: e.environment, label: labels("ENVIRONMENT", e.environment) }
          : null,
        sampleSize:
          e.sampleSize === null
            ? null
            : { value: e.sampleSize, unit: e.sampleUnit },
        uncertainty: e.uncertainty,
        conditions: conditionsText(e.conditions),
        applicability: e.homeReefApplicability
          ? { value: e.homeReefApplicability, reason: e.applicabilityReason }
          : null,
        anchors: e.anchors.map((a) => ({
          field: a.field,
          value:
            a.decision === "CORRECTED" ? a.correctedValue : a.normalizedValue,
          decision: a.decision,
          passage: { text: a.passage.text, locator: a.passage.locator },
        })),
      })),
      relationsFrom: c.relationsFrom.map((r) =>
        relation(r.kind, r.note, r.toClaim),
      ),
      relationsTo: c.relationsTo.map((r) =>
        relation(r.kind, r.note, r.fromClaim),
      ),
      validFrom: c.validFrom?.toISOString() ?? null,
      validUntil: c.validUntil?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
