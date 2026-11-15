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
  compareTeachingTexts,
  parseTeachingEditDecision,
  TEACHING_TEXT_SENTENCES_MAX,
  teachingDeckText,
  teachingTextSentences,
  type TeachingEditDiff,
  type TeachingOutputBody,
  type TeachingOutputEditDetail,
  type TeachingOutputEditSummary,
  type TeachingSlideText,
} from "@acropora/types";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import {
  TeachingOutputEditRepository,
  type TeachingOutputEditRow,
} from "./teaching-output-edit.repository.js";
import {
  renderTeachingNarrationText,
  teachingPrintableLines,
} from "./teaching-output-files.js";
import { TEACHING_OUTPUT_CLOCK } from "./teaching-output.service.js";
import {
  readTeachingPptxText,
  TeachingPptxError,
} from "./teaching-pptx-text.js";

/** The largest edited file taken; the multer limit stands at the upload too. */
export const TEACHING_EDIT_MAX_BYTES = 20 * 1024 * 1024;
/** A narration is plain text: past this it is no narration. */
const NARRATION_MAX_BYTES = 2 * 1024 * 1024;

/** What each kind of output takes back, by file name and type. */
const ACCEPTS = {
  SLIDES: {
    extensions: [".pptx"],
    types: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      // some browsers send no specific type for an Office file
      "application/octet-stream",
      "application/zip",
    ],
    refusal: "A diasorhoz csak .pptx tölthető fel.",
  },
  PRINTABLE: {
    extensions: [".pdf"],
    types: ["application/pdf", "application/octet-stream"],
    refusal: "A nyomtatható szöveghez csak .pdf tölthető fel.",
  },
  NARRATION: {
    extensions: [".txt", ".md"],
    types: ["text/plain", "text/markdown", "application/octet-stream"],
    refusal: "A narrációhoz csak .txt vagy .md szöveg tölthető fel.",
  },
} as const;

type UploadedFile = { originalname: string; mimetype: string; buffer: Buffer };

/** The generated text of a PDF or a narration, the way its file carries it. */
function generatedText(body: TeachingOutputBody): string {
  if (body.kind === "PRINTABLE")
    return teachingPrintableLines(body)
      .map((line) => line.text)
      .join("\n");
  if (body.kind === "NARRATION") return renderTeachingNarrationText(body);
  return "";
}

function sentencesWithin(text: string, what: string): string[] {
  const sentences = teachingTextSentences(text);
  if (sentences.length > TEACHING_TEXT_SENTENCES_MAX)
    throw new BadRequestException(
      `${what} ${sentences.length} mondatos; legfeljebb ${TEACHING_TEXT_SENTENCES_MAX} vethető össze.`,
    );
  return sentences;
}

/**
 * AN OUTPUT EDITED OUTSIDE THE SOURCE (T5.2, spec v2, points 3 and 6). The
 * edited copy is uploaded to the output it was made from, and compared with
 * what was generated: a deck slide by slide (its slide text), a PDF or a
 * narration sentence by sentence (the text read from the file). The editor
 * decides, once, whether the change goes back into the source; carrying it
 * over happens in the source (by hand or by the content agent), and the
 * source is approved again. This service does not touch the source.
 */
@Injectable()
export class TeachingOutputEditService {
  constructor(
    private readonly edits: TeachingOutputEditRepository,
    @Inject(TEACHING_OUTPUT_CLOCK) private readonly now: () => Date,
  ) {}

  private async output(
    contentId: string,
    outputId: string,
  ): Promise<TeachingOutputBody> {
    const output = await this.edits.output(contentId, outputId);
    if (!output || output.body.kind !== output.kind)
      throw new NotFoundException("Nincs ilyen kimenet.");
    return output.body;
  }

  private diff(
    body: TeachingOutputBody,
    edit: Pick<TeachingOutputEditRow, "slides" | "text">,
  ): TeachingEditDiff {
    if (body.kind === "SLIDES")
      return {
        kind: "SLIDES",
        ...compareTeachingDecks(teachingDeckText(body), edit.slides),
      };
    return {
      kind: "TEXT",
      ...compareTeachingTexts(
        teachingTextSentences(generatedText(body)),
        teachingTextSentences(edit.text ?? ""),
      ),
    };
  }

  private summary(
    edit: TeachingOutputEditRow,
    diff: TeachingEditDiff,
  ): TeachingOutputEditSummary {
    return {
      id: edit.id,
      outputId: edit.outputId,
      fileName: edit.fileName,
      sizeBytes: edit.sizeBytes,
      sha256: edit.sha256,
      uploadedById: edit.uploadedById,
      uploadedAt: edit.uploadedAt.toISOString(),
      changes: diff.changed,
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

  /** What the file says: the slides of a deck, the text of a PDF or narration. */
  private async extract(
    body: TeachingOutputBody,
    file: UploadedFile,
  ): Promise<{ slides: TeachingSlideText[]; text: string | null }> {
    if (body.kind === "SLIDES") {
      let slides: TeachingSlideText[];
      try {
        slides = readTeachingPptxText(file.buffer);
      } catch (error) {
        throw new BadRequestException(
          error instanceof TeachingPptxError
            ? error.message
            : "A diasor nem olvasható.",
        );
      }
      return {
        slides: cleanEditedSlides(slides, body.stamp.footer),
        text: null,
      };
    }
    if (body.kind === "PRINTABLE") {
      let lines: Awaited<ReturnType<typeof readPdfTextLines>>;
      try {
        lines = await readPdfTextLines(file.buffer);
      } catch {
        throw new BadRequestException("A PDF nem olvasható.");
      }
      // the footer stamp (with its page count) is on every page and is no content
      const text = lines
        .map((line) => line.text)
        .filter((line) => !line.trim().startsWith(body.stamp.footer))
        .join("\n");
      sentencesWithin(text, "A PDF");
      return { slides: [], text };
    }
    if (file.buffer.byteLength > NARRATION_MAX_BYTES)
      throw new BadRequestException("A narráció legfeljebb 2 MB szöveg lehet.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
    } catch {
      throw new BadRequestException("A narráció nem UTF-8 szöveg.");
    }
    sentencesWithin(text, "A narráció");
    return { slides: [], text };
  }

  async upload(
    contentId: string,
    outputId: string,
    file: UploadedFile,
    userId: string,
  ): Promise<TeachingOutputEditDetail> {
    const body = await this.output(contentId, outputId);
    if (file.buffer.byteLength > TEACHING_EDIT_MAX_BYTES)
      throw new BadRequestException(
        `A fájl legfeljebb ${TEACHING_EDIT_MAX_BYTES / 1024 / 1024} MB lehet.`,
      );
    const accepts = ACCEPTS[body.kind];
    const name = file.originalname.toLowerCase();
    if (
      !accepts.extensions.some((ext) => name.endsWith(ext)) ||
      !(accepts.types as readonly string[]).includes(file.mimetype)
    )
      throw new BadRequestException(accepts.refusal);
    const { slides, text } = await this.extract(body, file);
    const id = await this.edits.create({
      outputId,
      fileName: file.originalname.slice(0, 200),
      contentType: file.mimetype,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      bytes: file.buffer,
      slides,
      text,
      userId,
    });
    return this.detail(contentId, outputId, id);
  }

  async list(
    contentId: string,
    outputId: string,
  ): Promise<TeachingOutputEditSummary[]> {
    const body = await this.output(contentId, outputId);
    return (await this.edits.list(outputId)).map((edit) =>
      this.summary(edit, this.diff(body, edit)),
    );
  }

  async detail(
    contentId: string,
    outputId: string,
    id: string,
  ): Promise<TeachingOutputEditDetail> {
    const body = await this.output(contentId, outputId);
    const edit = await this.edits.get(outputId, id);
    if (!edit)
      throw new NotFoundException("Nincs ilyen szerkesztett változat.");
    const diff = this.diff(body, edit);
    return { ...this.summary(edit, diff), diff };
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
    await this.output(contentId, outputId);
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
