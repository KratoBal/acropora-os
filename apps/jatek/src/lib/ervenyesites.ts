/**
 * A BEKULDES ES A MEGEROSITES BEMENETENEK ELLENORZESE, a szerver oldalan (a `/api/*` utvonalak), mielott barmi az
 * api fele indulna. Nem helyettesiti az api ellenorzeset (az dont), csak a nyilvanvaloan rossz kereseket allitja meg
 * itt, es a kereset alakjat rogziti.
 */
export const MAX_VALASZ = 200;
export const MAX_EMAIL = 254;
export const MIN_NEV = 2;
export const MAX_NEV = 120;
const TOKEN = /^[A-Za-z0-9_.~-]{8,200}$/;
// szandekosan egyszeru: a pontos dontes az apie, az itteni szur csak a nyilvanvalo elgepelest fogja meg
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BekuldesKeres = {
  questionId: string;
  email: string;
  /** a beküldő neve: levágva, a belső szóközök egyre vonva (az api ugyanígy tárolja) */
  name: string;
  answer: string;
  website: string;
};

export type KeresEredmeny<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "INVALID_EMAIL"
        | "INVALID_NAME"
        | "INVALID_ANSWER"
        | "INVALID_TOKEN"
        | "BAD_REQUEST";
    };

const szoveg = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

export function bekuldesKeres(body: unknown): KeresEredmeny<BekuldesKeres> {
  if (!body || typeof body !== "object")
    return { ok: false, code: "BAD_REQUEST" };
  const b = body as Record<string, unknown>;
  const questionId = szoveg(b.questionId);
  const email = szoveg(b.email)?.trim() ?? null;
  const name = szoveg(b.name)?.replace(/\s+/g, " ").trim() ?? null;
  const answer = szoveg(b.answer);
  const website = szoveg(b.website) ?? "";
  if (!questionId || questionId.length > 64)
    return { ok: false, code: "BAD_REQUEST" };
  if (!email || email.length > MAX_EMAIL || !EMAIL.test(email))
    return { ok: false, code: "INVALID_EMAIL" };
  // a név: legalább két karakter, benne betű (az api is ezt kéri, itt csak a nyilvánvalót állítjuk meg)
  if (
    !name ||
    name.length < MIN_NEV ||
    name.length > MAX_NEV ||
    !/\p{L}/u.test(name)
  )
    return { ok: false, code: "INVALID_NAME" };
  if (answer === null) return { ok: false, code: "INVALID_ANSWER" };
  const trimmed = answer.trim();
  if (trimmed === "" || trimmed.length > MAX_VALASZ)
    return { ok: false, code: "INVALID_ANSWER" };
  // a botcsapda mezot VALTOZATLANUL tovabbadjuk (az api donti el, mit kezd vele), de korlatozott hosszal
  return {
    ok: true,
    value: {
      questionId,
      email,
      name,
      answer: trimmed,
      website: website.slice(0, 200),
    },
  };
}

export function megerositesKeres(
  body: unknown,
): KeresEredmeny<{ token: string }> {
  if (!body || typeof body !== "object")
    return { ok: false, code: "BAD_REQUEST" };
  const token = szoveg((body as Record<string, unknown>).token);
  if (!token || !TOKEN.test(token)) return { ok: false, code: "INVALID_TOKEN" };
  return { ok: true, value: { token } };
}
