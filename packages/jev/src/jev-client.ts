/**
 * A JEV (TypeSafe) CHOICE-HIVAS -- A V0 OFFLINE KIERTEKELOHOZ.
 *
 * Az alak acrobot meresebol (`exchange/jev-api-alak-2026-09-28.md`): POST
 * `/v1/systemone`, egy `choice` kerdes, a valasz `answers.<kerdes>.choice`,
 * `confidence`, `probabilities`, a gyoker `model` es `usage.input_tokens`.
 *
 * === A KULCS ===
 *
 * A hivo adja at (a futtato a `TYPESAFE_API_KEY` kornyezeti valtozobol). Ez a
 * modul CSAK a kereses fejlecebe teszi: nem naplozza, nem kerul hibauzenetbe,
 * es a visszaadott eredmenyben sincs benne. A hibauzenet a szolgaltato
 * torzsebol legfeljebb 500 karaktert tart meg (ACD-003 Q-003: `errorMessage`
 * vagva).
 *
 * === A ROGZITETT MODELL ELTUNESE NEM ATMENETI HIBA ===
 *
 * `Unknown model` eseten az eredmeny `MODEL_UNAVAILABLE`, ujraprobalas nelkul,
 * es a kiertekelo ettol MEGALL (ACD-003 Q-004 H: a policy leall, soha nem valt
 * magatol `jev-latest`-re).
 */

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface JevChoiceRequest {
  readonly apiKey: string;
  readonly model: string;
  /** A vetulet szovegkent (a merve mukodo alak). */
  readonly state: string;
  readonly instructions: string;
  /** opcio-kulcs -> leiras. */
  readonly criteria: Readonly<Record<string, string>>;
}

export type JevChoiceResult =
  | {
      readonly ok: true;
      readonly choice: string;
      readonly confidence: number;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly respondedModel: string;
      readonly inputTokens: number | null;
      readonly latencyMs: number;
      readonly attempts: number;
    }
  | {
      readonly ok: false;
      readonly errorCode:
        | "MODEL_UNAVAILABLE"
        | "PROVIDER_ERROR"
        | "BAD_RESPONSE"
        | "NETWORK_ERROR";
      readonly errorMessage: string;
      readonly httpStatus: number | null;
      readonly latencyMs: number;
      readonly attempts: number;
    };

const KERDES = "kategoria";

function vag(szoveg: string): string {
  return szoveg.length > 500 ? `${szoveg.slice(0, 500)}…` : szoveg;
}

export interface JevClientOptions {
  readonly fetch: FetchLike;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  /** A varakozas; a teszt ezt nullara allitja. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export async function jevChoice(
  request: JevChoiceRequest,
  options: JevClientOptions,
): Promise<JevChoiceResult> {
  const maxAttempts = options.maxAttempts ?? 4;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => performance.now());
  const body = JSON.stringify({
    state: request.state,
    model: request.model,
    questions: {
      [KERDES]: {
        type: "choice",
        instructions: request.instructions,
        criteria: request.criteria,
      },
    },
  });

  let utolso: JevChoiceResult | null = null;
  for (let probalkozas = 1; probalkozas <= maxAttempts; probalkozas++) {
    const kezdet = now();
    let status: number | null = null;
    let szoveg = "";
    let varakozas = 1000 * 2 ** (probalkozas - 1);
    try {
      const valasz = await options.fetch(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      status = valasz.status;
      szoveg = await valasz.text();
      const latencyMs = now() - kezdet;
      const ujra = valasz.headers.get("retry-after");
      if (ujra && /^\d+$/.test(ujra)) varakozas = Number(ujra) * 1000;

      if (status >= 200 && status < 300) {
        return ertelmez(szoveg, request, latencyMs, probalkozas);
      }
      if (/Unknown model/i.test(szoveg))
        return {
          ok: false,
          errorCode: "MODEL_UNAVAILABLE",
          errorMessage: vag(szoveg),
          httpStatus: status,
          latencyMs,
          attempts: probalkozas,
        };
      utolso = {
        ok: false,
        errorCode: "PROVIDER_ERROR",
        errorMessage: vag(szoveg),
        httpStatus: status,
        latencyMs,
        attempts: probalkozas,
      };
      /* A 4xx (a 429 kivetelevel) nem javul ujraprobalastol. */
      if (status >= 400 && status < 500 && status !== 429) return utolso;
    } catch (hiba) {
      utolso = {
        ok: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: vag(hiba instanceof Error ? hiba.message : String(hiba)),
        httpStatus: status,
        latencyMs: now() - kezdet,
        attempts: probalkozas,
      };
    }
    if (probalkozas < maxAttempts) await sleep(varakozas);
  }
  return utolso as JevChoiceResult;
}

function ertelmez(
  szoveg: string,
  request: JevChoiceRequest,
  latencyMs: number,
  attempts: number,
): JevChoiceResult {
  const rossz = (uzenet: string): JevChoiceResult => ({
    ok: false,
    errorCode: "BAD_RESPONSE",
    errorMessage: uzenet,
    httpStatus: 200,
    latencyMs,
    attempts,
  });
  let json: unknown;
  try {
    json = JSON.parse(szoveg);
  } catch {
    return rossz("A válasz nem JSON.");
  }
  const r = json as {
    model?: unknown;
    answers?: Record<
      string,
      { choice?: unknown; confidence?: unknown; probabilities?: unknown }
    >;
    usage?: { input_tokens?: unknown };
  };
  const valasz = r.answers?.[KERDES];
  if (!valasz) return rossz("A válaszban nincs meg a kérdés.");
  if (typeof valasz.choice !== "string" || !(valasz.choice in request.criteria))
    return rossz(
      `A választott kulcs nem a felkínált opciók egyike: ${JSON.stringify(valasz.choice)}`,
    );
  if (typeof valasz.confidence !== "number")
    return rossz("A válaszban nincs szám-bizonyosság.");
  const p =
    valasz.probabilities && typeof valasz.probabilities === "object"
      ? (valasz.probabilities as Record<string, number>)
      : {};
  return {
    ok: true,
    choice: valasz.choice,
    confidence: valasz.confidence,
    probabilities: p,
    respondedModel: typeof r.model === "string" ? r.model : "",
    inputTokens:
      typeof r.usage?.input_tokens === "number" ? r.usage.input_tokens : null,
    latencyMs,
    attempts,
  };
}
