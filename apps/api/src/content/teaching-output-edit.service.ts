import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  cleanEditedSlides,
  compareTeachingDecks,
  parseTeachingEditDecision,
  teachingDeckText,
  type TeachingOutputEditDetail,
  type TeachingOutputEditSummary,
} from "@acropora/types";

import {
  TeachingOutputEditRepository,
  type TeachingOutputEditRow,
} from "./teaching-output-edit.repository.js";
import { TEACHING_OUTPUT_CLOCK } from "./teaching-output.service.js";
import {
  readTeachingPptxText,
  TeachingPptxError,
} from "./teaching-pptx-text.js";

/** The largest edited deck taken; the multer limit stands at the upload too. */
export const TEACHING_EDIT_MAX_BYTES = 20 * 1024 * 1024;

const PPTX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // some browsers send no specific type for an Office file
  "application/octet-stream",
  "application/zip",
]);

/**
 * AN OUTPUT EDITED OUTSIDE THE SOURCE (T5.2, spec v2, points 3 and 6). The
 * edited copy is uploaded to the output it was made from; the difference is
 * the slide text of the generated deck against the text read from the file;
 * the editor decides, once, whether the change goes back into the source.
 * Carrying it over happens in the source (by hand or by the content agent),
 * and the source is approved again; this service does not touch the source.
 *
 * FIRST ROUND: SLIDE DECKS ONLY. The spec's case is the deck Luca reworks; an
 * edited PDF or narration is refused by name, not compared half-way.
 */
@Injectable()
export class TeachingOutputEditService {
  constructor(
    private readonly edits: TeachingOutputEditRepository,
    @Inject(TEACHING_OUTPUT_CLOCK) private readonly now: () => Date,
  ) {}

  private async slidesOutput(contentId: string, outputId: string) {
    const output = await this.edits.output(contentId, outputId);
    if (!output) throw new NotFoundException("Nincs ilyen kimenet.");
    if (output.kind !== "SLIDES" || output.body.kind !== "SLIDES")
      throw new ConflictException(
        "Egyelőre csak a diasor szerkesztett változata vethető össze a forrással.",
      );
    return output.body;
  }

  private summary(
    edit: TeachingOutputEditRow,
    changedSlides: number,
  ): TeachingOutputEditSummary {
    return {
      id: edit.id,
      outputId: edit.outputId,
      fileName: edit.fileName,
      sizeBytes: edit.sizeBytes,
      sha256: edit.sha256,
      uploadedById: edit.uploadedById,
      uploadedAt: edit.uploadedAt.toISOString(),
      changedSlides,
      decision:
        edit.decidedAt && edit.toSource !== null
          ? {
              toSource: edit.toSource,
              note: edit.decisionNote,
              byId: edit.decidedById,
              at: edit.decidedAt.toISOString(),
            }
          : null,
    };
  }

  async upload(
    contentId: string,
    outputId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    userId: string,
  ): Promise<TeachingOutputEditDetail> {
    const deck = await this.slidesOutput(contentId, outputId);
    if (file.buffer.byteLength > TEACHING_EDIT_MAX_BYTES)
      throw new BadRequestException(
        `A diasor legfeljebb ${TEACHING_EDIT_MAX_BYTES / 1024 / 1024} MB lehet.`,
      );
    if (
      !file.originalname.toLowerCase().endsWith(".pptx") ||
      !PPTX_TYPES.has(file.mimetype)
    )
      throw new BadRequestException("Csak .pptx diasor tölthető fel.");
    let slides;
    try {
      slides = readTeachingPptxText(file.buffer);
    } catch (error) {
      if (error instanceof TeachingPptxError)
        throw new BadRequestException(error.message);
      throw new BadRequestException("A diasor nem olvasható.");
    }
    const cleaned = cleanEditedSlides(slides, deck.stamp.footer);
    const id = await this.edits.create({
      outputId,
      fileName: file.originalname.slice(0, 200),
      contentType: file.mimetype,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      bytes: file.buffer,
      slides: cleaned,
      userId,
    });
    return this.detail(contentId, outputId, id);
  }

  async list(
    contentId: string,
    outputId: string,
  ): Promise<TeachingOutputEditSummary[]> {
    const deck = await this.slidesOutput(contentId, outputId);
    const generated = teachingDeckText(deck);
    return (await this.edits.list(outputId)).map((edit) =>
      this.summary(edit, compareTeachingDecks(generated, edit.slides).changed),
    );
  }

  async detail(
    contentId: string,
    outputId: string,
    id: string,
  ): Promise<TeachingOutputEditDetail> {
    const deck = await this.slidesOutput(contentId, outputId);
    const edit = await this.edits.get(outputId, id);
    if (!edit)
      throw new NotFoundException("Nincs ilyen szerkesztett változat.");
    const diff = compareTeachingDecks(teachingDeckText(deck), edit.slides);
    return { ...this.summary(edit, diff.changed), diff };
  }

  async decide(
    contentId: string,
    outputId: string,
    id: string,
    body: unknown,
    userId: string,
  ): Promise<TeachingOutputEditDetail> {
    const parsed = parseTeachingEditDecision(body);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    await this.slidesOutput(contentId, outputId);
    const edit = await this.edits.get(outputId, id);
    if (!edit)
      throw new NotFoundException("Nincs ilyen szerkesztett változat.");
    if (edit.decidedAt)
      throw new ConflictException("Erről a változatról már döntöttek.");
    const decided = await this.edits.decide({
      outputId,
      id,
      decision: parsed.value,
      userId,
      at: this.now(),
    });
    if (!decided)
      throw new ConflictException("Erről a változatról időközben döntöttek.");
    return this.detail(contentId, outputId, id);
  }
}
