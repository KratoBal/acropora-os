import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  parseAiGlossarySaveInput,
  personDisplayName,
  type AiGlossaryEntry,
  type AiGlossarySaveResult,
  type AiGlossaryVersion,
  type AiGlossaryVersionInfo,
} from "@acropora/types";

import {
  aiGlossaryClientFromEnv,
  type AiGlossaryClient,
  type AiGlossaryFailure,
  type RawGlossaryEntry,
  type RawGlossaryVersion,
  type RawGlossaryVersionInfo,
} from "./ai-glossary.client.js";

export const AI_GLOSSARY_CLIENT = Symbol("AI_GLOSSARY_CLIENT");
export const AI_GLOSSARY_ENVIRONMENT = Symbol("AI_GLOSSARY_ENVIRONMENT");
export const AI_GLOSSARY_USER_NAMES = Symbol("AI_GLOSSARY_USER_NAMES");

/** The client from the environment, resolved per call (the switch may be off, and the AI configuration may be absent). */
export type AiGlossaryClientFactory = () => AiGlossaryClient | null;
/** Display names for user ids (those that exist); an id with no user is simply absent from the map. */
export type AiGlossaryUserNames = (
  ids: readonly string[],
) => Promise<Map<string, string>>;

/**
 * THE OS EDITOR OF THE AI SERVICE'S AQUARIUM GLOSSARY IS ON ONLY WHERE THE ENVIRONMENT SAYS SO (card 7a5ea203, part C; acrobot 63288:
 * the switch is off by default, the test first). `AI_GLOSSARY_EDITOR=true`. Off: the endpoints answer 404, like every endpoint behind a
 * switch. A save changes the text the model is told, so it must not appear where nobody agreed to it.
 */
export function aiGlossaryAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return env.AI_GLOSSARY_EDITOR === "true";
}

export const SEED_AUTHOR_NAME = "Alapértelmezett (rendszer)";
export const UNKNOWN_USER_NAME = "Ismeretlen felhasználó";

/** The default lookup: the nickname the interfaces show, else the full name. */
export const databaseUserNames: AiGlossaryUserNames = async (ids) => {
  if (ids.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, displayName: true, nickname: true },
  });
  return new Map(rows.map((row) => [row.id, personDisplayName(row)]));
};

@Injectable()
export class AiGlossaryService {
  constructor(
    @Inject(AI_GLOSSARY_CLIENT)
    private readonly clientFactory: AiGlossaryClientFactory,
    @Inject(AI_GLOSSARY_ENVIRONMENT)
    private readonly environment: Record<string, string | undefined>,
    @Inject(AI_GLOSSARY_USER_NAMES)
    private readonly userNames: AiGlossaryUserNames,
  ) {}

  /** Off: 404. */
  private requireAllowed(): AiGlossaryClient {
    if (!aiGlossaryAllowed(this.environment)) throw new NotFoundException();
    const client = this.clientFactory();
    if (!client)
      throw new ServiceUnavailableException(
        "Az AI szolgáltatás kapcsolata nincs beállítva ebben a környezetben.",
      );
    return client;
  }

  /** What the AI service answered, in a person's words; the token and the service's own text never reach the answer. */
  private fail(failure: AiGlossaryFailure): never {
    switch (failure.kind) {
      case "conflict":
        throw new ConflictException({
          message:
            "Közben valaki más mentett egy újabb szójegyzéket" +
            (failure.activeVersion !== null
              ? ` (${failure.activeVersion}. verzió)`
              : "") +
            ". Töltsd újra az oldalt, és vidd át a módosításaidat.",
          activeVersion: failure.activeVersion,
        });
      case "invalid":
        throw new BadRequestException(failure.message);
      case "not-found":
        throw new NotFoundException("Nincs ilyen verzió.");
      case "unauthorized":
        throw new BadGatewayException(
          "Az AI szolgáltatás nem fogadta el a kérést (hitelesítés).",
        );
      case "timeout":
        throw new ServiceUnavailableException(
          "Az AI szolgáltatás nem válaszolt időben. Próbáld újra kicsit később.",
        );
      default:
        throw new ServiceUnavailableException(
          "Az AI szolgáltatás most nem érhető el. Próbáld újra kicsit később.",
        );
    }
  }

  /** The ids the AI service stored (`seed`, or an OS user id) as names. */
  private async namesFor(
    ids: readonly string[],
  ): Promise<(id: string | null) => string | null> {
    const real = [...new Set(ids.filter((id) => id !== "seed"))];
    const names = await this.userNames(real);
    return (id) =>
      id === null
        ? null
        : id === "seed"
          ? SEED_AUTHOR_NAME
          : (names.get(id) ?? UNKNOWN_USER_NAME);
  }

  async listVersions(): Promise<{ versions: AiGlossaryVersionInfo[] }> {
    const result = await this.requireAllowed().listVersions();
    if (!result.ok) this.fail(result);
    const name = await this.namesFor(
      result.value.map((version: RawGlossaryVersionInfo) => version.createdBy),
    );
    return {
      versions: result.value.map((version: RawGlossaryVersionInfo) => ({
        ...version,
        createdBy: name(version.createdBy) as string,
      })),
    };
  }

  async readVersion(rawVersion: string): Promise<AiGlossaryVersion> {
    const client = this.requireAllowed();
    if (!/^[1-9][0-9]{0,8}$/.test(rawVersion))
      throw new BadRequestException("A verzió száma hibás.");
    const result = await client.readVersion(Number(rawVersion));
    if (!result.ok) this.fail(result);
    const version: RawGlossaryVersion = result.value;
    const name = await this.namesFor([
      version.createdBy,
      ...version.entries.flatMap((entry: RawGlossaryEntry) =>
        entry.approvedBy !== null ? [entry.approvedBy] : [],
      ),
    ]);
    return {
      ...version,
      createdBy: name(version.createdBy) as string,
      entries: version.entries.map(
        (entry: RawGlossaryEntry): AiGlossaryEntry => ({
          ...entry,
          approvedBy: name(entry.approvedBy),
        }),
      ),
    };
  }

  /** `userId` is the OS user who saves: the AI service stores that id (not an e-mail), and the history shows the name. */
  async save(rawBody: unknown, userId: string): Promise<AiGlossarySaveResult> {
    const client = this.requireAllowed();
    const parsed = parseAiGlossarySaveInput(rawBody);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const result = await client.save({ ...parsed.value, createdBy: userId });
    if (!result.ok) this.fail(result);
    return result.value;
  }
}

export { aiGlossaryClientFromEnv };
