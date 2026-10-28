import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Optional,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Vocabulary } from "@acropora/knowledge-base";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { DISCOVERY_SWITCH_ENV } from "../discovery/discovery-run.js";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository.js";
import {
  AI_KNOWLEDGE_ANSWER_PATH_ENV,
  knowledgeAskerFromEnv,
  type KnowledgeAsker,
} from "./knowledge-answer-client.js";
import {
  answerQuestion,
  diagnoseQuestion,
  KnowledgeAnswerInputError,
  parseQuestion,
  type AnswerCandidate,
  type KnowledgeAnswer,
  type KnowledgeAnswerDiagnosis,
  type Subject,
} from "./knowledge-answer.js";
import { KnowledgeAnswerRepository } from "./knowledge-answer.repository.js";

export interface KnowledgeAnswerDeps {
  env: NodeJS.ProcessEnv;
  candidates: (subject: Subject) => Promise<AnswerCandidate[]>;
  approvedVocabulary: () => Promise<Vocabulary>;
  ask: KnowledgeAsker | null;
}

/** The dependencies, injectable for the tests. */
export const KNOWLEDGE_ANSWER_DEPS = Symbol("KNOWLEDGE_ANSWER_DEPS");

@Injectable()
export class KnowledgeAnswerService {
  private readonly logger = new Logger(KnowledgeAnswerService.name);
  private readonly deps: KnowledgeAnswerDeps;

  constructor(
    @Optional()
    @Inject(KNOWLEDGE_ANSWER_DEPS)
    deps: KnowledgeAnswerDeps | null = null,
  ) {
    const repository = new KnowledgeAnswerRepository();
    this.deps = deps ?? {
      env: process.env,
      candidates: (subject) => repository.candidates(subject),
      approvedVocabulary: () => new VocabularyRepository().approvedVocabulary(),
      ask: knowledgeAskerFromEnv(process.env),
    };
  }

  async answer(body: unknown): Promise<KnowledgeAnswer> {
    const { ask } = this.deps;
    this.requireSwitch();
    if (!ask)
      throw new ServiceUnavailableException(
        `Nincs AI-válaszoló beállítva (${AI_KNOWLEDGE_ANSWER_PATH_ENV}).`,
      );
    const result = await answerQuestion({ ...(await this.load(body)), ask });
    // the reasons, never the question or the answer text (plan 7, step 5: the reason goes to the log)
    this.logger.log({
      msg: "knowledge answer gated",
      answered: result.answered,
      notAnswered: result.notAnswered,
      package: result.package.claims,
      sent: result.package.sent.length,
      notStated: result.package.notStated.map((n) => n.failure),
      unpaired: result.package.unpaired.length,
      notForQuestion: result.package.notForQuestion.map((n) => n.reason),
      aiDropped: result.aiDropped.map((d) => d.reason),
      ai: result.ai.kind,
      aiRefused: result.ai.kind === "ANSWER" ? result.ai.refused : [],
      completed: result.completed.length,
      dropped: result.sentences.flatMap((s) =>
        s.status === "DROPPED" ? s.reasons.map((r) => r.code) : [],
      ),
      gateVersion: result.gateVersion,
    });
    return result;
  }

  /**
   * The package without the model call: no AI path needed, nothing called,
   * nothing stored.
   */
  async diagnose(body: unknown): Promise<KnowledgeAnswerDiagnosis> {
    this.requireSwitch();
    return diagnoseQuestion(await this.load(body));
  }

  private requireSwitch() {
    if (this.deps.env[DISCOVERY_SWITCH_ENV] !== "on")
      throw new ForbiddenException(
        `A kutatási tudástár ki van kapcsolva (${DISCOVERY_SWITCH_ENV}).`,
      );
  }

  private async load(body: unknown) {
    let parsed: ReturnType<typeof parseQuestion>;
    try {
      parsed = parseQuestion(body);
    } catch (error) {
      if (error instanceof KnowledgeAnswerInputError)
        throw new BadRequestException(error.message);
      throw error;
    }
    const [candidates, vocabulary] = await Promise.all([
      this.deps.candidates(parsed.subject),
      this.deps.approvedVocabulary(),
    ]);
    return { ...parsed, candidates, vocabulary };
  }
}

/**
 * MODE A, internal pilot (plan v4 7, S6): a question answered from accepted
 * knowledge only. `knowledge.view`: it reads what the claim store shows and
 * writes nothing; the research switch must be on.
 */
@Controller("knowledge-base/answers")
export class KnowledgeAnswerController {
  constructor(private readonly answers: KnowledgeAnswerService) {}

  @Post()
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  answer(@Body() body: unknown) {
    return this.answers.answer(body);
  }

  /**
   * The same question's package without the AI (acrobot 37290): a separate
   * route, not a flag on the one above, so a missing or mistyped flag can
   * never turn a diagnosis into a model call.
   */
  @Post("diagnosis")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  diagnose(@Body() body: unknown) {
    return this.answers.diagnose(body);
  }
}
