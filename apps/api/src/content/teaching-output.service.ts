import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  analyzeTeachingSource,
  buildTeachingOutput,
  parseTeachingSentInput,
  TEACHING_OUTPUT_KINDS,
  teachingOutputFlags,
  type TeachingOutputBody,
  type TeachingOutputDetail,
  type TeachingOutputKind,
  type TeachingOutputSummary,
} from "@acropora/types";

import {
  renderTeachingOutputFile,
  type TeachingOutputFile,
} from "./teaching-output-files.js";
import {
  TeachingOutputRepository,
  type TeachingOutputRow,
  type TeachingOutputSourceState,
} from "./teaching-output.repository.js";

export const TEACHING_OUTPUT_CLOCK = Symbol("TEACHING_OUTPUT_CLOCK");

function kindOf(value: unknown): TeachingOutputKind {
  if (
    typeof value !== "string" ||
    !(TEACHING_OUTPUT_KINDS as readonly string[]).includes(value)
  )
    throw new BadRequestException(`kind: ${TEACHING_OUTPUT_KINDS.join(", ")}`);
  return value as TeachingOutputKind;
}

/**
 * THE OUTPUTS OF A TEACHING SOURCE (T5.2, spec v2, points 2 and 3).
 *
 *   preview    any stored version, nothing stored: the editor sees what the
 *              source will give before it is approved
 *   generate   only from the APPROVED version, stored with it: "after the
 *              source's approval the outputs go on without an approval of
 *              their own"
 *   went out   recorded once per output; refused for a stale output, for one
 *              whose approval was withdrawn, and for an internal source to a
 *              public channel (spec v2, point 1)
 *
 * An output is stale when the source has a newer version; the list measures
 * it from the source, it is not stored.
 */
@Injectable()
export class TeachingOutputService {
  constructor(
    private readonly outputs: TeachingOutputRepository,
    @Inject(TEACHING_OUTPUT_CLOCK) private readonly now: () => Date,
  ) {}

  private async source(contentId: string): Promise<TeachingOutputSourceState> {
    const state = await this.outputs.state(contentId);
    if (!state) throw new NotFoundException("A tartalom nem található.");
    if (state.channel !== "TEACHING_SOURCE")
      throw new ConflictException("Ez a tartalom nem oktatóanyag-forrás.");
    if (state.version === null)
      throw new ConflictException("Az oktatóanyagnak még nincs forrása.");
    return state;
  }

  private async build(
    contentId: string,
    kind: TeachingOutputKind,
    version: number,
    at: Date,
  ): Promise<TeachingOutputBody> {
    const source = await this.outputs.versionSource(contentId, version);
    if (!source)
      throw new NotFoundException(`A forrásnak nincs ${version}. verziója.`);
    const open = new Set(
      analyzeTeachingSource(source).openQuestions.map((q) => q.numberId),
    );
    return buildTeachingOutput(kind, source, at.toISOString(), open);
  }

  async preview(
    contentId: string,
    kind: unknown,
    version: unknown,
  ): Promise<TeachingOutputBody> {
    const k = kindOf(kind);
    const state = await this.source(contentId);
    let v = state.version as number;
    if (version !== undefined && version !== "current") {
      const n = Number(version);
      if (typeof version !== "string" || !Number.isInteger(n) || n < 1)
        throw new BadRequestException(
          'version: a verzió száma vagy "current".',
        );
      v = n;
    }
    return this.build(contentId, k, v, this.now());
  }

  async generate(
    contentId: string,
    kind: unknown,
    userId: string,
  ): Promise<TeachingOutputDetail> {
    const k = kindOf(kind);
    const state = await this.source(contentId);
    if (state.itemState !== "READY_TO_SEND" || state.approvedVersion === null)
      throw new ConflictException(
        "Kimenet csak a jóváhagyott forrásból készül: előbb a forrást kell jóváhagyni.",
      );
    const at = this.now();
    const body = await this.build(contentId, k, state.approvedVersion, at);
    const id = await this.outputs.create({
      contentId,
      kind: k,
      sourceVersion: state.approvedVersion,
      body,
      generatedAt: at,
      userId,
    });
    return this.detail(contentId, id);
  }

  private summary(
    row: TeachingOutputRow,
    state: TeachingOutputSourceState,
  ): TeachingOutputSummary {
    return {
      id: row.id,
      kind: row.kind,
      sourceVersion: row.sourceVersion,
      generatedById: row.generatedById,
      generatedAt: row.generatedAt.toISOString(),
      stale: (state.version ?? 0) > row.sourceVersion,
      approved: state.approvedVersion === row.sourceVersion,
      ...teachingOutputFlags(row.body),
      edits: row.edits.length,
      undecidedEdits: row.edits.filter((e) => e.decidedAt === null).length,
      sent:
        row.sentAt && row.sentTo !== null
          ? {
              to: row.sentTo,
              public: row.sentPublic ?? false,
              byId: row.sentById,
              at: row.sentAt.toISOString(),
            }
          : null,
    };
  }

  async list(contentId: string): Promise<TeachingOutputSummary[]> {
    const state = await this.source(contentId);
    return (await this.outputs.list(contentId)).map((row) =>
      this.summary(row, state),
    );
  }

  async detail(contentId: string, id: string): Promise<TeachingOutputDetail> {
    const state = await this.source(contentId);
    const row = await this.outputs.get(contentId, id);
    if (!row) throw new NotFoundException("Nincs ilyen kimenet.");
    return { ...this.summary(row, state), body: row.body };
  }

  /** The output drawn as its file: PDF, PPTX or the narration as text. */
  async file(contentId: string, id: string): Promise<TeachingOutputFile> {
    await this.source(contentId);
    const row = await this.outputs.get(contentId, id);
    if (!row) throw new NotFoundException("Nincs ilyen kimenet.");
    return renderTeachingOutputFile(row.body);
  }

  async markSent(
    contentId: string,
    id: string,
    body: unknown,
    userId: string,
  ): Promise<TeachingOutputDetail> {
    const parsed = parseTeachingSentInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const state = await this.source(contentId);
    const row = await this.outputs.get(contentId, id);
    if (!row) throw new NotFoundException("Nincs ilyen kimenet.");
    if (row.sentAt)
      throw new ConflictException("Ez a kimenet már ki van küldve.");
    if ((state.version ?? 0) > row.sourceVersion)
      throw new ConflictException(
        "A kimenet elavult: a forrásnak újabb verziója van. Generáld újra.",
      );
    if (state.approvedVersion !== row.sourceVersion)
      throw new ConflictException(
        "A kimenet forrás-verziójának jóváhagyása visszavonva: előbb a forrást kell újra jóváhagyni.",
      );
    if (parsed.value.public && row.audience === "INTERNAL")
      throw new ConflictException(
        "Belső forrásból nyilvános csatornára nem mehet kimenet: ehhez a szerző vagy a jogtulajdonos engedélye és nyilvános felhasználási kör kell.",
      );
    const marked = await this.outputs.markSent({
      contentId,
      id,
      sourceVersion: row.sourceVersion,
      to: parsed.value.to,
      public: parsed.value.public,
      userId,
      at: this.now(),
    });
    if (!marked)
      throw new ConflictException(
        "Időközben változott: a kimenet ki lett küldve, vagy a forrás jóváhagyása megváltozott. Töltsd újra.",
      );
    return this.detail(contentId, id);
  }
}
