import { Controller, Get, Inject, Injectable, Optional } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  overviewOf,
  type Overview,
  type OverviewCounts,
} from "./knowledge-overview.js";
import { KnowledgeOverviewRepository } from "./knowledge-overview.repository.js";

export const KNOWLEDGE_OVERVIEW_COUNTS = Symbol("KNOWLEDGE_OVERVIEW_COUNTS");

@Injectable()
export class KnowledgeOverviewService {
  private readonly counts: () => Promise<OverviewCounts>;

  constructor(
    @Optional()
    @Inject(KNOWLEDGE_OVERVIEW_COUNTS)
    counts: (() => Promise<OverviewCounts>) | null = null,
  ) {
    const repository = new KnowledgeOverviewRepository();
    this.counts = counts ?? (() => repository.counts());
  }

  async overview(): Promise<Overview> {
    return overviewOf(await this.counts());
  }
}

/** A TUDÁSBÁZIS ÁTTEKINTŐJE (S4, Figma 3:2), `knowledge.view` joggal. */
@Controller("knowledge-base/overview")
export class KnowledgeOverviewController {
  constructor(private readonly overview: KnowledgeOverviewService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  get() {
    return this.overview.overview();
  }
}
