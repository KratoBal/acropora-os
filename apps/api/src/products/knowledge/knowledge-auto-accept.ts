/**
 * ACCEPTING A JEV RESULT BY RULE, NOT BY A PERSON (Product Knowledge step 2,
 * card 85c38ab1). Balázs, 2026-10-21 20:44 UTC: the manufacturer's dosing is
 * there for almost every water treatment agent, so take it, and bring to
 * review only what is uncertain or not found.
 *
 * A result is accepted only when ALL of these hold:
 * - it is VERIFIED and has a value;
 * - every page that states the value is the MANUFACTURER's (its page or
 *   document), read by a run, not typed by a reviewer;
 * - each of those pages also proves the product is ours: our own EAN or
 *   manufacturer part number, and the same page states the same one (the `ean`
 *   or `manufacturerSku` result is VERIFIED with our value AND that page in it);
 * - no person has accepted this field yet (a person's fact is never
 *   overwritten), and this very result is not accepted already.
 * Anything else stays for a person, with the reason.
 *
 * The fact it writes carries `acceptedByRule` and STAYS IN THE OS: the Medusa
 * projection does not take it until a person accepts the same result (the
 * webshop is frozen; acrobot 34884).
 */
export const AUTO_ACCEPT_RULE = "AUTO_V1";

/** The fields the rule may accept; one at a time, by decision. */
export const AUTO_ACCEPT_FIELDS = [
  "dosing",
  // the three dosing states (Balázs, 2026-10-21 22:08 UTC; slice 3)
  "dosingMode",
  "dosingGuidance",
  "dosingTests",
] as const;

const MANUFACTURER_SOURCES = new Set([
  "MANUFACTURER_PAGE",
  "MANUFACTURER_DOCUMENT",
]);
const IDENTITY_FIELDS = ["ean", "manufacturerSku"] as const;

/** One stored evidence entry, as the run writes it (`StoredEvidence`). */
export interface AutoEvidence {
  sourceType: string;
  sourceKind: string;
  sourceRef: string | null;
  accepted: boolean;
  manual?: true;
}

export interface AutoResult {
  id: string;
  status: string;
  value: string | null;
  evidence: readonly AutoEvidence[];
}

export interface AutoInput {
  field: string;
  /** The latest finished result of the field, or null. */
  result: AutoResult | null;
  /** The latest finished `ean` and `manufacturerSku` results. */
  identity: readonly (AutoResult | null)[];
  /** The product-level fact of the field, if there is one. */
  fact: { fieldResultId: string; acceptedByRule: string | null } | null;
}

export type AutoDecision =
  | { kind: "ACCEPT"; fieldResultId: string; value: string }
  | { kind: "SKIP"; reason: string };

/** A page a run read: not our own value, not a reviewer's entry. */
function isReadPage(e: AutoEvidence): boolean {
  return e.sourceKind !== "OS" && e.sourceKind !== "MANUAL" && !e.manual;
}

function evidenceOf(value: unknown): AutoEvidence[] {
  return Array.isArray(value) ? (value as AutoEvidence[]) : [];
}

/** The pages that prove the product is ours: our value and theirs agree. */
function identityPages(identity: readonly (AutoResult | null)[]): Set<string> {
  const pages = new Set<string>();
  for (const r of identity) {
    if (!r || r.status !== "VERIFIED") continue;
    const evidence = evidenceOf(r.evidence);
    if (!evidence.some((e) => e.accepted && e.sourceKind === "OS")) continue;
    for (const e of evidence)
      if (e.accepted && isReadPage(e) && e.sourceRef) pages.add(e.sourceRef);
  }
  return pages;
}

export function autoAcceptDecision(input: AutoInput): AutoDecision {
  const { result, fact } = input;
  if (!result) return { kind: "SKIP", reason: "nincs eredmény" };
  if (result.status !== "VERIFIED" || result.value === null)
    return { kind: "SKIP", reason: `státusz ${result.status}` };
  // "no data" is what Balázs asked to see himself (2026-10-21 20:44 UTC: "vagy
  // nem talált hozzá adatot"): never by rule
  if (input.field === "dosingMode" && result.value === "NO_DATA")
    return { kind: "SKIP", reason: "nincs adat: ember nézi meg" };
  if (fact && fact.acceptedByRule === null)
    return { kind: "SKIP", reason: "ember már elfogadta (nem írom felül)" };
  if (fact && fact.fieldResultId === result.id)
    return { kind: "SKIP", reason: "már elfogadva" };

  const pages = evidenceOf(result.evidence).filter(
    (e) => e.accepted && e.sourceKind !== "OS",
  );
  if (pages.length === 0)
    return { kind: "SKIP", reason: "nincs oldal-bizonyíték" };
  if (pages.some((e) => !isReadPage(e)))
    return { kind: "SKIP", reason: "kézi bizonyíték: ember fogadja el" };
  const foreign = pages.find((e) => !MANUFACTURER_SOURCES.has(e.sourceType));
  if (foreign)
    return {
      kind: "SKIP",
      reason: `nem gyártói forrás (${foreign.sourceType})`,
    };

  const proven = identityPages(input.identity);
  const unproven = pages.find((e) => !e.sourceRef || !proven.has(e.sourceRef));
  if (unproven)
    return {
      kind: "SKIP",
      reason: `a termék azonossága nem igazolt ezen a lapon (EAN vagy cikkszám): ${unproven.sourceRef ?? "-"}`,
    };
  return { kind: "ACCEPT", fieldResultId: result.id, value: result.value };
}

export interface AutoAcceptDeps {
  latestResult(productId: string, field: string): Promise<AutoResult | null>;
  productFact(
    productId: string,
    field: string,
  ): Promise<{ fieldResultId: string; acceptedByRule: string | null } | null>;
  /** The service's own accept, with the rule's name (all its checks run). */
  accept(productId: string, fieldResultId: string, rule: string): Promise<void>;
}

export interface AutoOutcome {
  productId: string;
  field: string;
  kind: "ACCEPTED" | "WOULD_ACCEPT" | "SKIP" | "FAILED";
  detail: string;
}

/** One pass over the named products; writes only with `apply`. */
export async function runAutoAccept(
  productIds: readonly string[],
  apply: boolean,
  deps: AutoAcceptDeps,
): Promise<AutoOutcome[]> {
  const out: AutoOutcome[] = [];
  for (const productId of productIds) {
    const identity = await Promise.all(
      IDENTITY_FIELDS.map((f) => deps.latestResult(productId, f)),
    );
    for (const field of AUTO_ACCEPT_FIELDS) {
      const decision = autoAcceptDecision({
        field,
        result: await deps.latestResult(productId, field),
        identity,
        fact: await deps.productFact(productId, field),
      });
      if (decision.kind === "SKIP") {
        out.push({ productId, field, kind: "SKIP", detail: decision.reason });
        continue;
      }
      if (!apply) {
        out.push({
          productId,
          field,
          kind: "WOULD_ACCEPT",
          detail: decision.value,
        });
        continue;
      }
      try {
        await deps.accept(productId, decision.fieldResultId, AUTO_ACCEPT_RULE);
        out.push({
          productId,
          field,
          kind: "ACCEPTED",
          detail: decision.value,
        });
      } catch (error) {
        // the service refused (a newer result, an unfinished run, ...): said, and on
        out.push({
          productId,
          field,
          kind: "FAILED",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return out;
}
