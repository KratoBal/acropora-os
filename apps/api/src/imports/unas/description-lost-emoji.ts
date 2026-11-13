/**
 * AZ ELVESZETT HANGULATJEL (kartya 7d63e55c, 2026-11-13).
 *
 * A UNAS a leirasokban a hangulatjelet MAR FELDOLGOZAS ELOTT negy kerdojelkent adja ("<h3>???? Ajanlott adagolas</h3>"): a nyers
 * getProduct-valasz a Fauna Marin AMIN (SKU 4260119450493) leirasaban 3f3f3f3f bajtokat hordoz, f0 9f.. egyet sem (acrobot merese,
 * agents/murena/megosztas/unas-emoji/amin-raw.xml). Egy hangulatjel UTF-8-ban negy bajt, a negy '?' bajtonkenti csere: a veszteseg a
 * UNAS tarolasanal tortenik, a mi parserunk, az OS tarolasa es a Medusa-iras nem veszit. Az eredeti jel NINCS MEG, tehat nem
 * visszaallithato; az elo UNAS-ba nem irunk (acrobot dontese).
 *
 * AMIT A BEOLVASAS TESZ: a PONTOSAN negy kerdojeles futast, amely szo elejen all (a szoveg elejen, szokoz vagy `>` utan) es szokoz
 * koveti, kiveszi a szovegbol a kovetkezo szokozzel egyutt, es megszamolja. Minden mas negyes futas (szo kozepen, szokoz nelkul,
 * ot kerdojel) erintetlen marad, de megszamoljuk (`remaining`), hogy a figyelmezteteson latsszon. A nyers valasz (`rawPayload`)
 * valtozatlan.
 */
export interface LostEmojiResult {
  readonly text: string | null;
  /** The runs taken out. */
  readonly removed: number;
  /** Exactly-four runs left in the text (not at a word start, or not followed by a space). */
  readonly remaining: number;
}

const AT_WORD_START = /(^|[\s>])\?{4}(?!\?)[ \t]/g;
const ANY_FOUR = /(?<!\?)\?{4}(?!\?)/g;

export function stripLostEmoji(text: string | null): LostEmojiResult {
  if (text === null) return { text, removed: 0, remaining: 0 };
  let removed = 0;
  const cleaned = text.replace(AT_WORD_START, (_all, before: string) => {
    removed += 1;
    return before;
  });
  const remaining = cleaned.match(ANY_FOUR)?.length ?? 0;
  return { text: cleaned, removed, remaining };
}
