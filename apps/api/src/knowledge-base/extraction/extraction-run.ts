import type { Vocabulary } from "@acropora/knowledge-base";

import { DISCOVERY_USER_AGENT } from "../discovery/scholarly-client.js";
import {
  SOURCE_FIELDS,
  checkClaims,
  keepOwnFindings,
  type CheckedClaim,
} from "./claim-check.js";
import { imageTiles } from "../../common/image-tiles.js";
import type {
  ClaimExtractor,
  FigureClaimExtractor,
} from "./claim-extractor.js";
import type { ExtractionStore } from "./extraction-store.js";
import { sha256 } from "./extraction-store.js";
import {
  chunkSections,
  chunkText,
  jatsSections,
  type TextSection,
} from "./jats-text.js";
import { createHash } from "node:crypto";
import {
  captionNamesPhosphate,
  figureCaptionLocator,
  figureImageLocator,
  jatsFigures,
} from "./jats-figures.js";
import { fetchPmcFigureImage } from "./pmc-figure-image.js";
import {
  MAX_FIGURE_PAGES,
  pdfPhosphateFigures,
  renderPdfPages,
} from "./pdf-figures.js";

import {
  fetchOpenPdf,
  isPdf,
  MAX_PDF_BYTES,
  pdfSections,
  type PdfFetch,
  type PdfSections,
} from "./pdf-full-text.js";

/**
 * THE CLAIM EXTRACTION OF A FEW SOURCES (plan v4, 9.2 S3).
 *
 * Per source: the open-access full text from Europe PMC (JATS), its sections,
 * one AI call per chunk of sections, the OS's own check of every claim, and,
 * with `apply`, the store. Without `apply` it does everything but the store.
 *
 * A source is skipped, with its reason, when: it is not found; the editor
 * did not include it at screening (NOT_INCLUDED: pending or excluded); it has a
 * RETRACTION version (nothing is built on a retracted work); it was already
 * extracted (its full-text hash is set, claims or not: the store writes it
 * even when nothing was found, so the AI is not paid twice for one text); it
 * has neither a PMCID nor an open-access link (NO_OPEN_FULL_TEXT: a closed
 * work needs the editor's manual PDF, below).
 *
 * THE EDITOR'S MANUAL PDF (task research-kezi-pdf; plan v4, 9.2 S3: "zárt
 * műhöz kézi PDF-feltöltés a szerkesztőnek"). The editor uploads the work's PDF
 * (`deps.manualPdf`); its text layer is read exactly as an open PDF's, and the
 * PDF is not kept: its sha256 is the source's content hash (plan J3). ONE TEXT
 * PER SOURCE: the manual PDF is the source's ORIGINAL text, so it is taken only
 * for a source not yet extracted, or as a re-extraction (barracuda, #1838: two
 * texts sharing the one "already extracted" mark would make it mean the wrong
 * one). The automatic run never reads a closed work, so it cannot overwrite it.
 *
 * Without a PMCID the open-access link is read as a PDF (`pdf-full-text.ts`:
 * its text layer, a section per page; research-kepes-kiolvasas, acrobot
 * 37378). The rest of the chain is the same: the chunks, the AI calls, the
 * OS's own check against the text read, the source's own findings. The
 * outcome names which text it was (`fullText`).
 *
 * A source the Crossref retraction check never covered (no DOI) is read, and
 * the outcome says so (`retractionUnchecked`); chunks past the limit are
 * counted (`chunksDropped`), not silently lost.
 *
 * The report carries counts and codes, never the text: the text is a third
 * party's, and the report lands in a terminal or a run record.
 */
export const EUROPE_PMC_FULL_TEXT = (pmcid: string) =>
  `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`;
export const MAX_SOURCES_PER_RUN = 5;
export const MAX_CHUNKS_PER_SOURCE = 6;
/** The AI side's refusal details a source's outcome keeps (counts and a code point each). */
export const MAX_REFUSAL_DETAILS = 20;
export const MAX_FULL_TEXT_BYTES = 5_000_000;
export const FULL_TEXT_TIMEOUT_MS = 30_000;

export type FullTextAnswer =
  { ok: true; xml: string } | { ok: false; reason: string };

export type TextFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<Response>;

/** The open full text, or why not. A 404 is "Europe PMC has no open text". */
export async function fetchFullText(
  pmcid: string,
  fetch: TextFetch,
): Promise<FullTextAnswer> {
  let response: Response;
  try {
    response = await fetch(EUROPE_PMC_FULL_TEXT(pmcid), {
      method: "GET",
      headers: {
        "User-Agent": DISCOVERY_USER_AGENT,
        Accept: "application/xml",
      },
      signal: AbortSignal.timeout(FULL_TEXT_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error)?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK",
    };
  }
  if (response.status === 404)
    return { ok: false, reason: "NO_OPEN_FULL_TEXT" };
  if (response.status !== 200)
    return { ok: false, reason: `HTTP_${response.status}` };
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_FULL_TEXT_BYTES) return { ok: false, reason: "TOO_LARGE" };
  const xml = await response.text();
  if (xml.length > MAX_FULL_TEXT_BYTES)
    return { ok: false, reason: "TOO_LARGE" };
  if (!/<article\b/i.test(xml)) return { ok: false, reason: "NOT_JATS" };
  return { ok: true, xml };
}

export interface SourceOutcome {
  sourceId: string;
  status: "EXTRACTED" | "PREVIEWED" | "SKIPPED";
  reason: string | null;
  sections: number;
  calls: number;
  /** AI calls that did not answer, by reason code. */
  unavailable: Record<string, number>;
  claims: number;
  fields: number;
  questions: number;
  /** Claims dropped whole, here or by the AI service, by code. */
  refusedClaims: Record<string, number>;
  /**
   * The AI service's own measure of where a refused passage left the text
   * ("PASSAGE_NOT_IN_TEXT: passage 22/87 U+0073"), at most
   * `MAX_REFUSAL_DETAILS`: to tell a model's rewording from a text the
   * reader broke (a PDF's line-end hyphen), without the text.
   */
  refusalDetails: string[];
  /** Fields dropped, by code. */
  refusedFields: Record<string, number>;
  claimsCreated: number;
  /** Re-extraction: the source's earlier, still unreviewed claims withdrawn. */
  claimsWithdrawn: number;
  /** Chunks past `MAX_CHUNKS_PER_SOURCE`, not read (barracuda, #1838). */
  chunksDropped: number;
  /** The Crossref retraction check never ran on this source (no DOI). */
  retractionUnchecked: boolean;
  /** Which full text was read: Europe PMC's JATS, the open PDF's text layer, the editor's PDF, or none. */
  fullText: "JATS" | "PDF" | "MANUAL_PDF" | null;
  /** PDF only: pages past the page cap, not read. */
  pagesDropped: number;
  /** The figures' image reading (research-kepes-ut); null: not run. */
  figures: FigureOutcome | null;
}

/**
 * THE FIGURES OF ONE SOURCE, counted (research-kepes-ut): counts and codes,
 * like the rest of the outcome, never a caption or a transcript.
 */
export interface FigureOutcome {
  /** Figures whose caption names the subject. */
  candidates: number;
  /** Past `MAX_FIGURES_PER_SOURCE`, not read. */
  dropped: number;
  /** A figure not read, by reason (image fetch, tiling, AI). */
  skipped: Record<string, number>;
  calls: number;
  tiles: number;
  /** Claims kept from the figures, and of them those whose passage is a tile's transcript. */
  claims: number;
  fromImage: number;
  refusedClaims: Record<string, number>;
  refusedFields: Record<string, number>;
  refusalDetails: string[];
}

export interface ExtractionDeps {
  store: ExtractionStore;
  extractor: ClaimExtractor;
  fetch: TextFetch;
  vocabulary: Vocabulary;
  now: () => Date;
  /** The open PDF's fetch: the address-guarded one by default. */
  pdfFetch?: PdfFetch;
  /** The stored run, when there is one: its row must still be RUNNING to store. */
  runId?: string;
  /**
   * RE-EXTRACTION (acrobot 35808: the fixed extraction run again on the same
   * five stage sources, to measure it). An already extracted source is read
   * again; storing it withdraws the source's still CANDIDATE claims, in the
   * same transaction, in this actor's name. A reviewed (VERIFIED) claim stays.
   */
  reextract?: { actorUserId: string | null };
  /** The editor's uploaded PDF (research-kezi-pdf): read instead of any open text, never kept. */
  manualPdf?: Uint8Array;
  /** The figures' image reading (research-kepes-ut); absent: the text only. */
  figureExtractor?: FigureClaimExtractor | null;
}

const count = (into: Record<string, number>, code: string) => {
  into[code] = (into[code] ?? 0) + 1;
};

/** A source's outcome before anything happened to it. */
export function emptyOutcome(sourceId: string): SourceOutcome {
  return {
    sourceId,
    status: "SKIPPED",
    reason: null,
    sections: 0,
    calls: 0,
    unavailable: {},
    claims: 0,
    fields: 0,
    questions: 0,
    refusedClaims: {},
    refusalDetails: [],
    refusedFields: {},
    claimsCreated: 0,
    claimsWithdrawn: 0,
    chunksDropped: 0,
    retractionUnchecked: false,
    fullText: null,
    pagesDropped: 0,
    figures: null,
  };
}

export type FullTextReading =
  | {
      ok: true;
      /** sha256 of the text read (the JATS, or the PDF's bytes). */
      contentHash: string;
      claims: CheckedClaim[];
      extractedBy: string;
      /** The locators of text no download holds (a figure's transcript): stored as not verified. */
      unverifiedLocators?: string[];
    }
  | { ok: false; reason: string };

interface ReadDeps {
  extractor: ClaimExtractor;
  fetch: TextFetch;
  vocabulary: Vocabulary;
  maxChunks?: number;
  /** The open PDF's fetch: the address-guarded one by default (tests give their own). */
  pdfFetch?: PdfFetch;
  figureExtractor?: FigureClaimExtractor | null;
}

/**
 * One open full text read and checked, nothing stored: the download, the
 * sections, one AI call per chunk (at most `maxChunks`), the OS's own check
 * of every claim against all sections, and the source's own findings. The
 * counts go into `outcome`. The S3 run stores what this returns; the mode B
 * research draft (S6) keeps it in memory only.
 */
export async function readFullTextClaims(
  pmcid: string,
  outcome: SourceOutcome,
  deps: ReadDeps,
): Promise<FullTextReading> {
  const text = await fetchFullText(pmcid, deps.fetch);
  if (!text.ok) return text;
  outcome.fullText = "JATS";
  const sections = jatsSections(text.xml);
  const read = await readSectionClaims(
    sections,
    sha256(text.xml),
    outcome,
    deps,
  );
  // the figures only on a text that was read: a source no call answered stays unread
  if (!read.ok || !deps.figureExtractor) return read;
  return withFigures(
    read,
    await readFigureClaims(pmcid, text.xml, sections, outcome, {
      ...deps,
      figureExtractor: deps.figureExtractor,
    }),
    outcome,
  );
}

/** The text's claims and the figures' together, the outcome's counts over both. */
function withFigures(
  read: Extract<FullTextReading, { ok: true }>,
  figures: FigureReading,
  outcome: SourceOutcome,
): FullTextReading {
  const claims = [...read.claims, ...figures.claims];
  outcome.claims = claims.length;
  outcome.fields = claims.reduce(
    (n, c) => n + c.anchors.filter((a) => a.proposed === undefined).length,
    0,
  );
  outcome.questions = claims.reduce(
    (n, c) => n + c.anchors.filter((a) => a.proposed !== undefined).length,
    0,
  );
  return { ...read, claims, unverifiedLocators: figures.unverifiedLocators };
}

export const MAX_FIGURES_PER_SOURCE = 6;
/**
 * A tile's byte cap here, under the AI service's (8 MiB a tile, 24 MiB a call):
 * four tiles of 6 MiB fit both (barracuda, #1978 review). A chart's PNG is far
 * smaller; a photo-like figure falls back to a baseline JPEG.
 */
export const FIGURE_TILE_MAX_BYTES = 6 * 1024 * 1024;

/**
 * THE FIGURES WHOSE CAPTION NAMES THE SUBJECT, READ FROM THEIR IMAGE
 * (research-kepes-ut, slice 3). Per figure: its image from the PMC open-access
 * dataset, the tiles (`image-tiles.ts`), one AI call with the caption and the
 * tiles, and the OS's own check of every claim against the paper's sections,
 * the caption and the AI's transcripts, one per tile.
 *
 * WHAT IS VERIFIED AND WHAT IS NOT. A passage or anchor that stands in the
 * paper's text or its caption is a downloaded text, verified as any other. One
 * that stands only in a transcript is the model's reading of the image: its
 * locator ("Figure 3, image tile 2/4") is returned in `unverifiedLocators`, and
 * the store keeps it with `verifiedVerbatimAt` NULL. The answer gate refuses a
 * claim with no verified passage (NO_VERBATIM_EVIDENCE), so such a claim waits
 * for the editor and is not answered from.
 *
 * The OS does not take the AI's `origin` on trust; it locates every text itself
 * and applies the same rule (acropora-ai-agent #59): an anchor in a transcript
 * is kept only on a claim whose passage is that very tile's, so a verified
 * claim never carries a number only the image reading holds
 * (ANCHOR_ACROSS_PARTS). The study's own fields (study type, measurement
 * method) are the text's, never a figure's (SOURCE_FIELD_FROM_FIGURE). A
 * claim whose passage stands in the paper's sections is the text call's to
 * find (a caption inside a section is read there too): it is dropped as a
 * twin (PASSAGE_IN_TEXT). What is left is what only the figure holds: a
 * caption outside the sections (a `<floats-group>`), or the image.
 */
export async function readFigureClaims(
  pmcid: string,
  xml: string,
  sections: readonly TextSection[],
  outcome: SourceOutcome,
  deps: ReadDeps & { figureExtractor: FigureClaimExtractor },
): Promise<FigureReading> {
  const figures = jatsFigures(xml).filter((f) =>
    captionNamesPhosphate(f.caption),
  );
  return readFigures(
    figures.map((f) => ({
      label: f.label,
      where: f.label,
      caption: f.caption,
      image: () => fetchPmcFigureImage(pmcid, f.href, deps.fetch),
    })),
    sections,
    outcome,
    deps,
  );
}

/**
 * The same reading on a PDF's figures (slice 4): the captions from the page
 * sections, the image the rendered page (`pdf-figures.ts`), each page drawn
 * once however many figures it holds. A caption stands in its page's section,
 * so a claim on it is the text call's twin; what is left is the image's.
 */
export async function readPdfFigureClaims(
  bytes: Uint8Array,
  read: PdfSections,
  outcome: SourceOutcome,
  deps: ReadDeps & { figureExtractor: FigureClaimExtractor },
): Promise<FigureReading> {
  // the captions also after the references (a manuscript's figure pages); the
  // claims are still checked against the read sections, plus the caption
  const sections = read.sections;
  const figures = pdfPhosphateFigures([
    ...read.sections,
    ...read.afterReferences,
  ]);
  const pages = [...new Set(figures.map((f) => f.page))].slice(
    0,
    MAX_FIGURE_PAGES,
  );
  const rendered = pages.length
    ? await renderPdfPages(bytes, pages)
    : new Map();
  return readFigures(
    figures.map((f) => ({
      label: f.label,
      where: `${f.label}, p. ${f.page}`,
      caption: f.caption,
      image: async () =>
        rendered.has(f.page)
          ? { ok: true as const, bytes: rendered.get(f.page)! }
          : {
              ok: false as const,
              reason: pages.includes(f.page) ? "NOT_RENDERED" : "PAGE_CAP",
            },
    })),
    sections,
    outcome,
    deps,
  );
}

/** One figure to read: what names it, where it stands, and its image when asked. */
interface FigureToRead {
  label: string;
  /** The locators' base: the label, and for a PDF its page. */
  where: string;
  caption: string;
  image: () => Promise<
    { ok: true; bytes: Uint8Array } | { ok: false; reason: string }
  >;
}

interface FigureReading {
  claims: CheckedClaim[];
  unverifiedLocators: string[];
}

async function readFigures(
  figures: readonly FigureToRead[],
  sections: readonly TextSection[],
  outcome: SourceOutcome,
  deps: ReadDeps & { figureExtractor: FigureClaimExtractor },
): Promise<FigureReading> {
  const fo: FigureOutcome = {
    candidates: figures.length,
    dropped: Math.max(0, figures.length - MAX_FIGURES_PER_SOURCE),
    skipped: {},
    calls: 0,
    tiles: 0,
    claims: 0,
    fromImage: 0,
    refusedClaims: {},
    refusedFields: {},
    refusalDetails: [],
  };
  outcome.figures = fo;
  const vocabularyKeys = {
    taxa: deps.vocabulary.taxa.map((t) => t.key),
    environments: deps.vocabulary.environments.map((t) => t.key),
    effects: deps.vocabulary.effects.map((t) => t.key),
  };
  const checked: CheckedClaim[] = [];
  const unverifiedLocators: string[] = [];
  const inText = new Set(sections.map((s) => s.locator));
  for (const figure of figures.slice(0, MAX_FIGURES_PER_SOURCE)) {
    const image = await figure.image();
    if (!image.ok) {
      count(fo.skipped, `IMAGE_${image.reason}`);
      continue;
    }
    const tiling = await imageTiles(image.bytes, {
      maxBytes: FIGURE_TILE_MAX_BYTES,
    });
    if (!tiling.ok) {
      count(fo.skipped, `TILES_${tiling.reason}`);
      continue;
    }
    fo.calls += 1;
    fo.tiles += tiling.tiles.length;
    const answer = await deps.figureExtractor.extract({
      subject: "PHOSPHATE",
      vocabulary: vocabularyKeys,
      figure: figure.label,
      caption: figure.caption,
      images: tiling.tiles.map((t) => ({
        contentType: t.contentType,
        bytes: t.bytes,
      })),
    });
    if (answer.kind === "UNAVAILABLE") {
      count(fo.skipped, `AI_UNAVAILABLE`);
      count(outcome.unavailable, answer.reason);
      continue;
    }
    if (answer.kind === "REFUSED") {
      count(fo.refusedClaims, `AI_${answer.refusal}`);
      if (answer.detail && fo.refusalDetails.length < MAX_REFUSAL_DETAILS)
        fo.refusalDetails.push(`${answer.refusal}: ${answer.detail}`);
      continue;
    }
    for (const code of answer.refusedClaims)
      count(fo.refusedClaims, `AI_${code}`);
    for (const detail of answer.refusalDetails ?? [])
      if (fo.refusalDetails.length < MAX_REFUSAL_DETAILS)
        fo.refusalDetails.push(detail);
    const imageSections = answer.transcripts.map((text, i) => ({
      locator: figureImageLocator(figure.where, i + 1, tiling.tiles.length),
      text,
    }));
    const imageLocators = new Set(imageSections.map((s) => s.locator));
    unverifiedLocators.push(...imageLocators);
    // the paper's own text first: a passage it holds is located, and verified, there
    const result = checkClaims(
      answer.claims,
      [
        ...sections,
        { locator: figureCaptionLocator(figure.where), text: figure.caption },
        ...imageSections,
      ],
      deps.vocabulary,
    );
    for (const code of result.refusedClaims) count(fo.refusedClaims, code);
    for (const claim of result.claims) {
      // the paper's own text is the text call's: a figure claim there would be a twin
      if (inText.has(claim.passage.locator)) {
        count(fo.refusedClaims, "PASSAGE_IN_TEXT");
        continue;
      }
      const ownTile = imageLocators.has(claim.passage.locator)
        ? claim.passage.locator
        : null;
      const kept = claim.anchors.filter(
        (a) =>
          (!imageLocators.has(a.locator) || a.locator === ownTile) &&
          !SOURCE_FIELDS.includes(a.field),
      );
      for (const a of claim.anchors) {
        if (kept.includes(a)) continue;
        const refusal = SOURCE_FIELDS.includes(a.field)
          ? "SOURCE_FIELD_FROM_FIGURE"
          : "ANCHOR_ACROSS_PARTS";
        claim.refused.push({ field: a.field, refusal });
        // the column goes with its anchor (keepOwnFindings does the same)
        (claim as unknown as Record<string, unknown>)[a.field] = null;
      }
      claim.anchors = kept;
      for (const r of claim.refused) count(fo.refusedFields, r.refusal);
      checked.push({ ...claim, extractedBy: answer.extractedBy });
    }
  }
  const own = keepOwnFindings(checked, deps.vocabulary);
  for (const code of own.refusedClaims) count(fo.refusedClaims, code);
  for (const code of own.refusedFields) count(fo.refusedFields, code);
  fo.claims = own.claims.length;
  fo.fromImage = own.claims.filter((c) =>
    unverifiedLocators.includes(c.passage.locator),
  ).length;
  return { claims: own.claims, unverifiedLocators };
}

/** The same reading on an open PDF's text layer (no PMCID, an open-access link). */
export async function readPdfClaims(
  url: string,
  outcome: SourceOutcome,
  deps: ReadDeps,
): Promise<FullTextReading> {
  // never the general fetch: a third party's link goes through the address guard
  const pdf = await fetchOpenPdf(url, deps.pdfFetch);
  if (!pdf.ok) return pdf;
  outcome.fullText = "PDF";
  let read: Awaited<ReturnType<typeof pdfSections>>;
  try {
    read = await pdfSections(pdf.bytes);
  } catch {
    return { ok: false, reason: "PDF_UNREADABLE" };
  }
  outcome.pagesDropped = read.pagesDropped;
  const claims = await readSectionClaims(
    read.sections,
    pdf.contentHash,
    outcome,
    deps,
  );
  if (!claims.ok || !deps.figureExtractor) return claims;
  return withFigures(
    claims,
    await readPdfFigureClaims(pdf.bytes, read, outcome, {
      ...deps,
      figureExtractor: deps.figureExtractor,
    }),
    outcome,
  );
}

/** The editor's PDF, read as an open PDF's text layer; the bytes are not kept, their sha256 is. */
export async function readManualPdfClaims(
  bytes: Uint8Array,
  outcome: SourceOutcome,
  deps: ReadDeps,
): Promise<FullTextReading> {
  if (bytes.byteLength > MAX_PDF_BYTES)
    return { ok: false, reason: "TOO_LARGE" };
  if (!isPdf(bytes)) return { ok: false, reason: "NOT_PDF" };
  outcome.fullText = "MANUAL_PDF";
  let read: Awaited<ReturnType<typeof pdfSections>>;
  try {
    read = await pdfSections(bytes);
  } catch {
    return { ok: false, reason: "PDF_UNREADABLE" };
  }
  outcome.pagesDropped = read.pagesDropped;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const claims = await readSectionClaims(
    read.sections,
    contentHash,
    outcome,
    deps,
  );
  if (!claims.ok || !deps.figureExtractor) return claims;
  return withFigures(
    claims,
    await readPdfFigureClaims(bytes, read, outcome, {
      ...deps,
      figureExtractor: deps.figureExtractor,
    }),
    outcome,
  );
}

async function readSectionClaims(
  sections: readonly TextSection[],
  contentHash: string,
  outcome: SourceOutcome,
  deps: ReadDeps,
): Promise<FullTextReading> {
  const maxChunks = deps.maxChunks ?? MAX_CHUNKS_PER_SOURCE;
  outcome.sections = sections.length;
  if (!sections.length) return { ok: false, reason: "NO_SECTIONS" };

  const vocabularyKeys = {
    taxa: deps.vocabulary.taxa.map((t) => t.key),
    environments: deps.vocabulary.environments.map((t) => t.key),
    effects: deps.vocabulary.effects.map((t) => t.key),
  };
  let checked: CheckedClaim[] = [];
  let extractedBy = "unknown";
  let answered = 0;
  const chunks = chunkSections(sections);
  outcome.chunksDropped = Math.max(0, chunks.length - maxChunks);
  for (const chunk of chunks.slice(0, maxChunks)) {
    outcome.calls += 1;
    const answer = await deps.extractor.extract({
      sourceText: chunkText(chunk),
      subject: "PHOSPHATE",
      vocabulary: vocabularyKeys,
    });
    if (answer.kind === "UNAVAILABLE") {
      count(outcome.unavailable, answer.reason);
      continue;
    }
    if (answer.kind === "REFUSED") {
      count(outcome.refusedClaims, `AI_${answer.refusal}`);
      // why a whole answer was refused: kept even when no call answered
      if (answer.detail && outcome.refusalDetails.length < MAX_REFUSAL_DETAILS)
        outcome.refusalDetails.push(`${answer.refusal}: ${answer.detail}`);
      continue;
    }
    answered += 1;
    extractedBy = answer.extractedBy;
    for (const code of answer.refusedClaims)
      count(outcome.refusedClaims, `AI_${code}`);
    for (const detail of answer.refusalDetails ?? [])
      if (outcome.refusalDetails.length < MAX_REFUSAL_DETAILS)
        outcome.refusalDetails.push(detail);
    // the OS checks against ALL sections: a field's anchor may stand in another one
    const result = checkClaims(answer.claims, sections, deps.vocabulary);
    for (const code of result.refusedClaims) count(outcome.refusedClaims, code);
    for (const claim of result.claims) {
      for (const r of claim.refused) count(outcome.refusedFields, r.refusal);
      checked.push(claim);
    }
  }
  // a text no call answered is not "extracted": its hash is not written, it can be read again
  if (answered === 0)
    return {
      ok: false,
      reason:
        outcome.calls ===
        Object.values(outcome.unavailable).reduce((a, b) => a + b, 0)
          ? "AI_UNAVAILABLE"
          : "AI_REFUSED",
    };
  // only this source's own findings, its study fields once (acrobot 35808)
  const own = keepOwnFindings(checked, deps.vocabulary);
  for (const code of own.refusedClaims) count(outcome.refusedClaims, code);
  for (const code of own.refusedFields) count(outcome.refusedFields, code);
  checked = own.claims;
  outcome.fields = checked.reduce(
    (n, c) => n + c.anchors.filter((a) => a.proposed === undefined).length,
    0,
  );
  outcome.questions = checked.reduce(
    (n, c) => n + c.anchors.filter((a) => a.proposed !== undefined).length,
    0,
  );
  outcome.claims = checked.length;
  return { ok: true, contentHash, claims: checked, extractedBy };
}

export async function extractSource(
  sourceId: string,
  apply: boolean,
  deps: ExtractionDeps,
): Promise<SourceOutcome> {
  const outcome = emptyOutcome(sourceId);
  const skip = (reason: string) => ({ ...outcome, reason });
  const source = await deps.store.source(sourceId);
  if (!source) return skip("NOT_FOUND");
  if (!source.included) return skip("NOT_INCLUDED");
  if (source.retracted) return skip("RETRACTED");
  if (source.alreadyExtracted && !deps.reextract)
    return skip("ALREADY_EXTRACTED");
  outcome.retractionUnchecked = source.retractionUnchecked;
  if (!deps.manualPdf && !source.pmcid && !source.oaUrl)
    return skip("NO_OPEN_FULL_TEXT");
  const read = deps.manualPdf
    ? await readManualPdfClaims(deps.manualPdf, outcome, deps)
    : source.pmcid
      ? await readFullTextClaims(source.pmcid, outcome, deps)
      : await readPdfClaims(source.oaUrl!, outcome, deps);
  if (!read.ok) return skip(read.reason);
  if (!apply) return { ...outcome, status: "PREVIEWED" };
  const saved = await deps.store.saveSource({
    sourceId,
    contentHash: read.contentHash,
    extractedBy: read.extractedBy,
    claims: read.claims,
    verifiedAt: deps.now(),
    ...(deps.runId ? { runId: deps.runId } : {}),
    ...(deps.reextract?.actorUserId
      ? { replaceCandidatesBy: deps.reextract.actorUserId }
      : {}),
    ...(read.unverifiedLocators?.length
      ? { unverifiedLocators: read.unverifiedLocators }
      : {}),
  });
  return {
    ...outcome,
    status: "EXTRACTED",
    claimsCreated: saved.claimsCreated,
    claimsWithdrawn: saved.claimsWithdrawn ?? 0,
  };
}
