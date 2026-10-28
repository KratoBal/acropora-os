import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Optional,
  Post,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { DISCOVERY_SWITCH_ENV } from "../discovery/discovery-run.js";
import { PrismaDiscoveryStore } from "../discovery/discovery-run.store.js";
import {
  ScholarlyClient,
  type ApiFetch,
} from "../discovery/scholarly-client.js";
import { researchDraftRunning } from "../research-drafts/research-draft.store.js";
import {
  checkReferences,
  type ReferenceReport,
  type ReferenceSource,
} from "./reference-check.js";
import { includedReferenceSources } from "./reference-check.repository.js";

/**
 * T1 OF THE RESEARCH TEST SET, BEHIND A SIGNED-IN CALL (plan v4, 10; S7;
 * acrobot 37232): the fleet has no shell in the stage api container, so the
 * CLI would take Balázs's hands. The same check, read only, answered in the
 * request: `knowledge.manage`, behind the discovery's switch (it calls the
 * same external registries, and production keeps the switch off).
 *
 * It shares the keyless Crossref and Europe PMC budget with the discovery
 * and a mode B draft, so it does not start while either runs. It waits on
 * Crossref's pace (about a second a request), so a call is capped at
 * MAX_SYNC_SOURCES sources; more is the CLI's job.
 */
export const REFERENCE_DEPS = Symbol("KNOWLEDGE_REFERENCE_DEPS");
export const MAX_SYNC_SOURCES = 60;

export interface ReferenceServiceDeps {
  env: NodeJS.ProcessEnv;
  sources: () => Promise<{ checkable: ReferenceSource[]; withoutId: string[] }>;
  /** A discovery run or a mode B draft is running: the budget is in use. */
  busy: () => Promise<boolean>;
  fetch: ApiFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

@Injectable()
export class KnowledgeReferenceService {
  private readonly logger = new Logger(KnowledgeReferenceService.name);
  private readonly deps: ReferenceServiceDeps;

  constructor(
    @Optional()
    @Inject(REFERENCE_DEPS)
    deps: ReferenceServiceDeps | null = null,
  ) {
    this.deps = deps ?? {
      env: process.env,
      sources: includedReferenceSources,
      busy: async () =>
        (await new PrismaDiscoveryStore().running()) !== null ||
        (await researchDraftRunning()),
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
    };
  }

  async check(): Promise<
    ReferenceReport & {
      withoutIdentifier: number;
      /** The INCLUDED sources with neither a DOI nor a PMID: ids only, for the editor. */
      withoutIdentifierIds: string[];
      requests: number;
    }
  > {
    if (this.deps.env[DISCOVERY_SWITCH_ENV] !== "on")
      throw new ForbiddenException(
        `A hivatkozás-ellenőrzés a kutatási felderítés kapcsolója mögött áll (${DISCOVERY_SWITCH_ENV}).`,
      );
    if (await this.deps.busy())
      throw new ConflictException(
        "Fut egy felderítés vagy egy kutatási tervezet; az ellenőrzés utána indítható.",
      );
    const { checkable, withoutId } = await this.deps.sources();
    if (checkable.length === 0)
      throw new BadRequestException(
        "Nincs DOI-val vagy PMID-vel rendelkező befogadott forrás.",
      );
    if (checkable.length > MAX_SYNC_SOURCES)
      throw new BadRequestException(
        `Több mint ${MAX_SYNC_SOURCES} forrás: ezt a parancssori ellenőrzés viszi (knowledge:check-references).`,
      );
    const client = new ScholarlyClient({
      fetch: this.deps.fetch,
      sleep: this.deps.sleep,
      now: this.deps.now,
      requestLimit: checkable.length * 2 * 3,
    });
    const report = await checkReferences(checkable, client);
    // counts and codes, never a title
    this.logger.log({
      msg: "reference check",
      identifiers: report.identifiers,
      resolved: report.resolved,
      met: report.met,
      verdicts: report.results
        .filter((r) => r.verdict !== "RESOLVED")
        .map((r) => r.verdict),
    });
    return {
      ...report,
      withoutIdentifier: withoutId.length,
      withoutIdentifierIds: withoutId,
      requests: client.requestCount,
    };
  }
}

@Controller("knowledge-base/reference-checks")
export class KnowledgeReferenceController {
  constructor(private readonly references: KnowledgeReferenceService) {}

  @Post()
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  check() {
    return this.references.check();
  }
}
