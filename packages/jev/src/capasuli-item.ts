/**
 * A CÁPASULI NAPI JELENTŐ EGY TÉTELE: NEKÜNK SZÓLÓ TECHNIKAI HIBA-E.
 *
 * Balázs döntése, 2026-10-05 08:00 UTC (acrobot emlék 2069): a jelentőt a Jev
 * nézi át, és csak a nekünk szóló technikai hiba lesz piszkozat. Ez a PD-001
 * (személyes adat a Jevnek nem) alól EGYEDI KIVÉTEL erre a folyamra: az
 * e-mail-címeket a Jev előtt maszkoljuk, a nevek mehetnek. Ezért itt NEM az r14
 * teljes kitakarása fut, hanem csak az e-mail-maszk, a kitakaró SAJÁT
 * e-mail-mintáival.
 *
 * A szövegek (utasítás, osztályok) a policy részei: átírásuk új policy-verzió.
 */
import { JEV_MODEL, PATTERNS } from "./redact-r11-data.js";
import { pyre } from "./pyre.js";

export const CAPASULI_ITEM_POLICY = {
  key: "service-drafts.capasuli-item",
  version: 1,
  /** Rögzített modell; eltűnése esetén a szűrés leáll, nincs `jev-latest`. */
  model: JEV_MODEL,
  schema: "service-drafts.capasuli-item@1",
  /** Egy jelentő-tétel: `<forrás>:<postafiók>:<jelentés napja>:<ujjlenyomat>`. */
  entityType: "ServiceTicketDraft",
} as const;

export const CAPASULI_ITEM_QUESTION_KEY = "kind";

export const CAPASULI_ITEM_INSTRUCTIONS =
  "'message' is one item from the 'faults and actions' part of a daily report " +
  "sent by the aquarium staff of the Budapest Zoo (Cápasuli). The company " +
  "maintains the aquarium life-support systems there. Which class is the item?";

/** A három osztály; a sorrend a policy része. */
export const CAPASULI_ITEM_CLASSES: Readonly<Record<string, string>> = {
  OUR_TECHNICAL_FAULT:
    "A fault, failure or need on equipment the company maintains: tanks, " +
    "pumps and motors, filters (bioszűrő, homokszűrő, szűrőkosár), protein " +
    "skimmer (lehabzó), lighting, controllers and displays (LCD, kijelző), " +
    "dosing, chemicals and additives running out, pipes and plumbing of the " +
    "aquarium systems.",
  NOT_OURS:
    "A real issue, but not the company's to fix: the building, doors, roof " +
    "or leaks from the roof, opening hours, diving gear, animal care, staff " +
    "or visitor matters.",
  NOT_A_FAULT:
    "Not a problem at all: thanks, greetings, a signature or footer, 'nem " +
    "volt' (there was none), an empty or decorative line.",
};

/** Ennyi jel megy ki egy tételből; a tétel ennél rövidebb szokott lenni. */
export const MAX_CAPASULI_ITEM_CHARS = 1500;

/** A kapcsoló: CSAK a kimondott `live` értékre fut; minden más KI. */
export function capasuliFilterEnabled(value: string | undefined): boolean {
  return value?.trim() === "live";
}

/**
 * A KITAKARÓ E-MAIL-MINTÁI, UGYANÚGY FORDÍTVA, MINT A KITAKARÓBAN: nem másolat,
 * hanem a közös táblázat `EMAIL` sorai. Egy új e-mail-alak a táblázatban így
 * ide is megérkezik.
 */
const EMAIL_PATTERNS = PATTERNS.filter(([kind]) => kind === "EMAIL").map(
  ([, src]) => pyre(src, { global: true }),
);

/** Az utolsó őr: ami ezek után is e-mail-címnek látszik, az nem mehet ki. */
const LEFTOVER_EMAIL = /[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[^\W\d_]{2,}/u;

export const EMAIL_PLACEHOLDER = "[EMAIL]";

export class CapasuliItemBlocked extends Error {
  constructor(readonly outcome: "blocked_email_guard" | "blocked_empty") {
    super(outcome);
  }
}

/** Az e-mail-címek helyén `[EMAIL]`; a többi szöveg (a nevek is) marad. */
export function maskEmails(text: string): { text: string; count: number } {
  let count = 0;
  let out = text.normalize("NFC");
  for (const rx of EMAIL_PATTERNS)
    out = out.replace(rx, () => {
      count++;
      return EMAIL_PLACEHOLDER;
    });
  return { text: out, count };
}

export interface CapasuliItemRequest {
  readonly state: Readonly<Record<string, string>>;
  readonly questionKey: string;
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
  readonly model: string;
  readonly maskedEmails: number;
}

/**
 * A kérés egy tételre. `CapasuliItemBlocked`-ot dob, ha a szöveg nem mehet ki:
 * ilyenkor NINCS hívás, és a hívó a tételt szűretlenül piszkozatnak hagyja.
 */
export function buildCapasuliItemRequest(item: string): CapasuliItemRequest {
  const masked = maskEmails(item);
  const message = [...masked.text.trim()]
    .slice(0, MAX_CAPASULI_ITEM_CHARS)
    .join("");
  if (message === "") throw new CapasuliItemBlocked("blocked_empty");
  if (LEFTOVER_EMAIL.test(message))
    throw new CapasuliItemBlocked("blocked_email_guard");
  return {
    state: { message },
    questionKey: CAPASULI_ITEM_QUESTION_KEY,
    instructions: CAPASULI_ITEM_INSTRUCTIONS,
    criteria: { ...CAPASULI_ITEM_CLASSES },
    model: JEV_MODEL,
    maskedEmails: masked.count,
  };
}
