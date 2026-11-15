import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  analyzeTeachingSource,
  parseTeachingSourceInput,
  type TeachingSourceEditorData,
} from "@acropora/types";

import { TeachingSourceRepository } from "./teaching-source.repository.js";

/** How many problems one refusal names; the rest are counted. */
const PROBLEMS_SHOWN = 10;

/**
 * THE TEACHING SOURCE OF A CONTENT ITEM (T5.2, spec v2). The approval path is
 * the content item's (`ContentService.move`); this service reads and writes
 * the source, and refuses one whose text does not match its number table: a
 * reference to a number, a form or a spoken form that does not exist, a part
 * number used in another part, a half-written reference. An open question is
 * no refusal here (the editor saves it to work on it); it stops the approval.
 */
@Injectable()
export class TeachingSourceService {
  constructor(private readonly sources: TeachingSourceRepository) {}

  /** The source, what its table and text say about each other, and whether it may change now. */
  async get(contentId: string): Promise<TeachingSourceEditorData> {
    const [source, editable] = await Promise.all([
      this.sources.detail(contentId),
      this.sources.editable(contentId),
    ]);
    return {
      source,
      analysis: source ? analyzeTeachingSource(source) : null,
      editable,
    };
  }

  async save(
    contentId: string,
    body: unknown,
    userId: string,
  ): Promise<TeachingSourceEditorData> {
    const parsed = parseTeachingSourceInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const { problems } = analyzeTeachingSource(parsed.value);
    if (problems.length) {
      const shown = problems.slice(0, PROBLEMS_SHOWN).map((p) => p.message);
      if (problems.length > PROBLEMS_SHOWN)
        shown.push(`(és még ${problems.length - PROBLEMS_SHOWN} hiba)`);
      throw new BadRequestException(shown.join(" "));
    }

    const outcome = await this.sources.save(contentId, parsed.value, userId);
    if (outcome.kind === "missing")
      throw new NotFoundException("A tartalom nem található.");
    if (outcome.kind === "not-teaching-source")
      throw new ConflictException("Ez a tartalom nem oktatóanyag-forrás.");
    if (outcome.kind === "not-editable")
      throw new ConflictException(
        "A forrás jóváhagyásra vár vagy már jóvá van hagyva: csak javításra visszaküldve módosítható.",
      );
    if (outcome.kind === "stale")
      throw new ConflictException(
        outcome.currentVersion === null
          ? "A forrás még nincs elmentve: az első mentés baseVersion értéke null."
          : `A forrást időközben más is mentette (most a ${outcome.currentVersion}. verzió). Töltsd újra, mielőtt mentesz.`,
      );
    return this.get(contentId);
  }
}
