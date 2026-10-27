import { prisma, type Prisma } from "@acropora/database";
import type {
  Applicability,
  ClaimLayer,
  Environment,
} from "@acropora/knowledge-base";
import { claimScope } from "../claims/claim-store.js";
import {
  LIST_SELECT,
  levelOf,
  sourceOf,
  sourceRef,
  type ListClaim,
} from "../claims/claim-store.repository.js";
import { CLAIM_ON_INCLUDED_SOURCE } from "../included-source.js";
import type { AnswerCandidate, Subject } from "./knowledge-answer.js";

/**
 * THE CANDIDATES OF A MODE A ANSWER: the VERIFIED claims of the topic on
 * included sources, each with its scope, its verbatim support, its original
 * quantity, its CONTRADICTS partners and a readable reference.
 *
 * It reads `KnowledgeClaim` and nothing else: a research draft (mode B) has no
 * relation to the claim tables, so its content cannot reach a package by this
 * query (the integration spec measures it with a draft on the same topic).
 */

const decimal = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const text = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());

/** "Kim Koop" -> "Koop", "Koop K" -> "Koop", "Koop, Kim" -> "Koop". */
export function familyName(name: string): string {
  const n = name.trim().replace(/\s+/gu, " ");
  if (n.includes(",")) return n.split(",")[0]!.trim();
  const words = n.split(" ");
  const last = words[words.length - 1] ?? n;
  return words.length > 1 && /^\p{Lu}{1,3}\.?$/u.test(last) ? words[0]! : last;
}

export interface CitedSource {
  authors: Prisma.JsonValue;
  year: number | null;
  title: string;
}

/**
 * "Koop és mtsai, 2001"; two sources joined with "; "; a third and more as
 * "és további N". Without authors the title stands, cut to 60 characters.
 */
export function citationOf(sources: readonly CitedSource[]): string | null {
  const one = (s: CitedSource) => {
    const names = Array.isArray(s.authors)
      ? s.authors.flatMap((a) =>
          a &&
          typeof a === "object" &&
          !Array.isArray(a) &&
          typeof a.name === "string" &&
          a.name.trim()
            ? [familyName(a.name)]
            : [],
        )
      : [];
    const who =
      names.length === 0
        ? s.title.length > 60
          ? `${s.title.slice(0, 59).trimEnd()}…`
          : s.title
        : names.length === 1
          ? names[0]!
          : names.length === 2
            ? `${names[0]} és ${names[1]}`
            : `${names[0]} és mtsai`;
    return s.year === null ? who : `${who}, ${s.year}`;
  };
  if (sources.length === 0) return null;
  const shown = sources.slice(0, 2).map(one);
  const rest = sources.length - shown.length;
  return rest > 0 ? `${shown.join("; ")} és további ${rest}` : shown.join("; ");
}

export function candidateOf(
  c: ListClaim & { subject: string },
  sources: ReadonlyMap<string, CitedSource>,
): AnswerCandidate {
  const live = c.evidence.filter(
    (e) => e.stance === "SUPPORTS" && !sourceRef(sourceOf(e)).retracted,
  );
  const verbatim = live.filter((e) => e.passage.verifiedVerbatimAt !== null);
  const cited = [...new Set(verbatim.map((e) => sourceOf(e).id))].flatMap(
    (id) => (sources.has(id) ? [sources.get(id)!] : []),
  );
  const contradicts = [
    ...c.relationsFrom.map((r) => ({ kind: r.kind, other: r.toClaim })),
    ...c.relationsTo.map((r) => ({ kind: r.kind, other: r.fromClaim })),
  ]
    .filter((r) => r.kind === "CONTRADICTS" && r.other.status === "VERIFIED")
    .map((r) => r.other.id);
  return {
    id: c.id,
    layer: c.layer as ClaimLayer,
    subject: c.subject,
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
    verbatimSupport: verbatim.length,
    // no usage policy yet: the pilot releases a VERIFIED claim for the
    // internal surface only, never AI_PUBLIC (plan 7 (e); PR #1928)
    uses: ["AI_INTERNAL"],
    citation: citationOf(cited),
    quantity:
      c.originalUnit === null
        ? null
        : {
            min: text(c.originalMin),
            max: text(c.originalMax),
            unit: c.originalUnit,
            basis: c.chemicalBasis,
          },
    contradicts: [...new Set(contradicts)],
  };
}

export class KnowledgeAnswerRepository {
  async candidates(
    subject: Subject,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<AnswerCandidate[]> {
    const rows = await client.knowledgeClaim.findMany({
      where: { subject, status: "VERIFIED", ...CLAIM_ON_INCLUDED_SOURCE },
      orderBy: [{ id: "asc" }],
      select: { ...LIST_SELECT, subject: true },
    });
    const ids = [
      ...new Set(rows.flatMap((c) => c.evidence.map((e) => sourceOf(e).id))),
    ];
    const sources = new Map(
      (
        await client.knowledgeSource.findMany({
          where: { id: { in: ids } },
          select: { id: true, authors: true, year: true, title: true },
        })
      ).map((s) => [s.id, s]),
    );
    return rows.map((c) => candidateOf(c, sources));
  }
}
