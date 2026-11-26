import {
  AI_CHAT_BASE_URL_ENV,
  AI_CHAT_TOKEN_ENV,
} from "../integrations/ai-chat/ai-chat.config.js";

/**
 * THE AI SERVICE'S GLOSSARY OVER HTTP (acropora-ai-agent `GET /v1/glossary/versions`, `GET /v1/glossary/versions/:version`,
 * `PUT /v1/glossary`; ai#149; card 7a5ea203, part C2). The token is held by this process only: it never leaves here, not in a response
 * and not in an error. No model is called, so the wait is short (eight seconds), not the chat's.
 *
 * Every answer is read AGAIN here: the AI service is ours, but this side does not take a shape on trust. A body that is not the contract
 * is "unavailable", never a half-filled value. The ids it returns (`createdBy`, `approvedBy`) are raw: the service resolves names.
 */
export const AI_GLOSSARY_TIMEOUT_MS = 8_000;

export type RawGlossaryEntry = {
  abbreviation: string;
  original: string;
  language: "en" | "de";
  hungarian: string;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
};
export type RawGlossaryVersionInfo = {
  version: number;
  createdAt: string;
  createdBy: string;
  note: string;
  entryCount: number;
  active: boolean;
};
export type RawGlossaryVersion = Omit<RawGlossaryVersionInfo, "entryCount"> & {
  entries: RawGlossaryEntry[];
};
export type RawSaveResult = {
  version: number;
  takesEffectWithinSeconds: number;
};

export type AiGlossaryFailure =
  | {
      ok: false;
      kind:
        | "not-configured"
        | "unreachable"
        | "timeout"
        | "unauthorized"
        | "not-found"
        | "unavailable";
    }
  | { ok: false; kind: "conflict"; activeVersion: number | null }
  | { ok: false; kind: "invalid"; message: string };
export type AiGlossaryResult<T> = { ok: true; value: T } | AiGlossaryFailure;

export interface AiGlossaryClient {
  listVersions(): Promise<AiGlossaryResult<RawGlossaryVersionInfo[]>>;
  readVersion(version: number): Promise<AiGlossaryResult<RawGlossaryVersion>>;
  save(input: {
    expectedVersion: number | null;
    entries: Array<
      Pick<
        RawGlossaryEntry,
        "abbreviation" | "original" | "language" | "hungarian" | "approved"
      >
    >;
    createdBy: string;
    note: string;
  }): Promise<AiGlossaryResult<RawSaveResult>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;
const isText = (value: unknown): value is string => typeof value === "string";
const isNullableText = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

export function rawEntryOf(value: unknown): RawGlossaryEntry | null {
  if (!isRecord(value)) return null;
  const {
    abbreviation,
    original,
    language,
    hungarian,
    approved,
    approvedBy,
    approvedAt,
  } = value;
  if (!isText(abbreviation) || !isText(original) || !isText(hungarian))
    return null;
  if (language !== "en" && language !== "de") return null;
  if (typeof approved !== "boolean") return null;
  if (
    !isNullableText(approvedBy ?? null) ||
    !isNullableText(approvedAt ?? null)
  )
    return null;
  return {
    abbreviation,
    original,
    language,
    hungarian,
    approved,
    approvedBy: (approvedBy as string | null) ?? null,
    approvedAt: (approvedAt as string | null) ?? null,
  };
}

export function rawVersionInfoOf(
  value: unknown,
): RawGlossaryVersionInfo | null {
  if (!isRecord(value)) return null;
  const { version, createdAt, createdBy, note, entryCount, active } = value;
  if (
    !isInteger(version) ||
    !isText(createdAt) ||
    !isText(createdBy) ||
    !isText(note)
  )
    return null;
  if (typeof entryCount !== "number" || typeof active !== "boolean")
    return null;
  return { version, createdAt, createdBy, note, entryCount, active };
}

export function rawVersionOf(value: unknown): RawGlossaryVersion | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  const { version, createdAt, createdBy, note, active } = value;
  if (
    !isInteger(version) ||
    !isText(createdAt) ||
    !isText(createdBy) ||
    !isText(note) ||
    typeof active !== "boolean"
  )
    return null;
  const entries = value.entries.map(rawEntryOf);
  if (entries.some((entry) => entry === null)) return null;
  return {
    version,
    createdAt,
    createdBy,
    note,
    active,
    entries: entries as RawGlossaryEntry[],
  };
}

export function rawSaveResultOf(value: unknown): RawSaveResult | null {
  if (!isRecord(value)) return null;
  const { version, takesEffectWithinSeconds } = value;
  if (
    !isInteger(version) ||
    typeof takesEffectWithinSeconds !== "number" ||
    takesEffectWithinSeconds < 0
  )
    return null;
  return { version, takesEffectWithinSeconds };
}

export class HttpAiGlossaryClient implements AiGlossaryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call(
    method: "GET" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; status: number; json: unknown } | AiGlossaryFailure> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(AI_GLOSSARY_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ok: false,
        kind:
          (error as Error)?.name === "TimeoutError" ? "timeout" : "unreachable",
      };
    }
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, status: response.status, json };
    if (response.status === 401) return { ok: false, kind: "unauthorized" };
    if (response.status === 404) return { ok: false, kind: "not-found" };
    if (response.status === 409) {
      const active =
        isRecord(json) && isInteger(json.activeVersion)
          ? json.activeVersion
          : null;
      return { ok: false, kind: "conflict", activeVersion: active };
    }
    if (response.status === 400) {
      const message =
        isRecord(json) && isText(json.message)
          ? json.message.slice(0, 300)
          : "A szójegyzék nem fogadható el.";
      return { ok: false, kind: "invalid", message };
    }
    return { ok: false, kind: "unavailable" };
  }

  async listVersions(): Promise<AiGlossaryResult<RawGlossaryVersionInfo[]>> {
    const result = await this.call("GET", "/v1/glossary/versions");
    if (!result.ok) return result;
    const list =
      isRecord(result.json) && Array.isArray(result.json.versions)
        ? result.json.versions.map(rawVersionInfoOf)
        : null;
    if (!list || list.some((item) => item === null))
      return { ok: false, kind: "unavailable" };
    return { ok: true, value: list as RawGlossaryVersionInfo[] };
  }

  async readVersion(
    version: number,
  ): Promise<AiGlossaryResult<RawGlossaryVersion>> {
    const result = await this.call("GET", `/v1/glossary/versions/${version}`);
    if (!result.ok) return result;
    const parsed = rawVersionOf(result.json);
    return parsed
      ? { ok: true, value: parsed }
      : { ok: false, kind: "unavailable" };
  }

  async save(
    input: Parameters<AiGlossaryClient["save"]>[0],
  ): Promise<AiGlossaryResult<RawSaveResult>> {
    const result = await this.call("PUT", "/v1/glossary", input);
    if (!result.ok) return result;
    const parsed = rawSaveResultOf(result.json);
    return parsed
      ? { ok: true, value: parsed }
      : { ok: false, kind: "unavailable" };
  }
}

/** The client from the environment, or `null`: no AI configuration, no call. */
export function aiGlossaryClientFromEnv(
  environment: NodeJS.ProcessEnv,
): AiGlossaryClient | null {
  const baseUrl = environment[AI_CHAT_BASE_URL_ENV]?.trim();
  const token = environment[AI_CHAT_TOKEN_ENV]?.trim();
  if (!baseUrl || !token) return null;
  return new HttpAiGlossaryClient(baseUrl.replace(/\/+$/, ""), token);
}
