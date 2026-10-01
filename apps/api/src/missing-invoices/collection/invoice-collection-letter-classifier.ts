import type { LetterClassification } from "./letter-class-jev.service.js";

/**
 * A JEV BESOROLÁSÁBÓL JAVASLAT (levél-válogatás terv, 4. szelet; acrobot 25803).
 *
 * A besoroló a 3. szelet, nautilus `LetterClassJevService`-e (#1356): a saját
 * kapcsolójával (`JEV_LETTER_CLASS`, alapból KI), a kitakaróval (r14) és az
 * őrrel, fájlonként egy DecisionRun-nal (HIDDEN). A begyűjtő csak azt dönti el,
 * mi legyen az eredménnyel: „bejövő számla” a küszöb felett SUGGESTED, minden más
 * UNMATCHED marad, mint eddig. A javaslatként megmutatott futás SHOWN lesz, és a
 * jóváhagyás oldja fel (ACCEPTED vagy OVERRIDDEN).
 */

/** A Jev osztálya, ami javaslatot ér. A többi osztály nem jelölt. */
export const INCOMING_INVOICE_CLASS = "BEJOVO_SZAMLA";

/**
 * TISZTA FÜGGVÉNY: javaslat, vagy semmi. A küszöb alatti, a más osztályú, a
 * hiányzó és a hibás (nem 0..1 közötti bizonyosság, üres futás-azonosító)
 * eredmény egyaránt semmi.
 */
export function suggestionOf(
  classification: LetterClassification | null,
  threshold: number,
): { confidence: number; decisionRunId: string } | null {
  if (!classification) return null;
  const { kind, confidence, decisionRunId } = classification;
  if (kind !== INCOMING_INVOICE_CLASS) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    return null;
  if (confidence < threshold) return null;
  if (!decisionRunId) return null;
  return { confidence, decisionRunId };
}
