import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { VocabularyInputError } from "../vocabulary/vocabulary-versions.js";
import { VocabularyConflict } from "../vocabulary/vocabulary.repository.js";
import {
  ReviewInputError,
  parseDiscardReason,
  parseReviewInput,
} from "./claim-review.js";
import {
  ClaimNotFound,
  ClaimReviewConflict,
  ClaimReviewRepository,
  ClaimShapeUnsupported,
  type ClaimReview,
} from "./claim-review.repository.js";

/** The repository, injectable for the tests. */
export const CLAIM_REVIEW_REPOSITORY = Symbol("CLAIM_REVIEW_REPOSITORY");

export type ClaimReviewStore = Pick<
  ClaimReviewRepository,
  "queue" | "detail" | "save" | "discard"
>;

@Injectable()
export class ClaimReviewService {
  private readonly repository: ClaimReviewStore;

  constructor(
    @Optional()
    @Inject(CLAIM_REVIEW_REPOSITORY)
    repository: ClaimReviewStore | null = null,
  ) {
    this.repository = repository ?? new ClaimReviewRepository();
  }

  queue() {
    return this.repository.queue();
  }

  async detail(claimId: string): Promise<ClaimReview> {
    return this.mapped(() => this.repository.detail(claimId));
  }

  async save(
    claimId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ClaimReview> {
    return this.mapped(async () =>
      this.repository.save(claimId, parseReviewInput(body), user.id),
    );
  }

  async discard(
    claimId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ClaimReview> {
    return this.mapped(async () =>
      this.repository.discard(claimId, parseDiscardReason(body), user.id),
    );
  }

  private async mapped<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (
        error instanceof ReviewInputError ||
        error instanceof VocabularyInputError
      )
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      if (error instanceof ClaimNotFound)
        throw new NotFoundException("Nincs ilyen állítás.");
      if (
        error instanceof ClaimReviewConflict ||
        error instanceof VocabularyConflict
      )
        throw new ConflictException(error.message);
      if (error instanceof ClaimShapeUnsupported)
        throw new ConflictException(
          "Ennek az állításnak több bizonyítéka van: ez a képernyő egyet kezel.",
        );
      throw error;
    }
  }
}
