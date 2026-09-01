/**
 * A KIKÜLDÉS TÉNYÉNEK BEHÚZÁSA: mit kezdjünk a külső lekérdezés eredményével.
 *
 * TISZTA FÜGGVÉNY, hogy a szabály azelőtt mérhető legyen, hogy a behúzás
 * megépülne. A hívó adja be, amit a külső felület visszaadott, és azt, amit a
 * tábla ma tud; ez pedig megmondja, mi változik.
 *
 * A LAPOZÓ VÉGIGJÁRÁSA A HÍVÓ DOLGA, ÉS EZ NÉMA HIBA FORRÁSA. A külső
 * lekérdezés alapértelmezett limitje TÍZ (mérve 2026-09-01, barracuda). Aki
 * „minden posztot" kér a kurzor követése nélkül, csendben az utolsó tízet
 * kapja: a hívás nem hibázik, csak keveset ad. Ezért nem elég a listát átvenni
 * -- a `complete` mezővel a hívónak KI KELL MONDANIA, hogy végigjárta-e.
 *
 * MIÉRT SZÁMÍT: egy hiányzó bejegyzés pontosan úgy néz ki, mint egy ki nem
 * küldött poszt. Ha hiányos listából jelölnénk, a tábla nem lenne rosszabb --
 * csak épp abban maradna, amiért az egész felület készül.
 */
export interface ExternalPost {
  /** A külső felület azonosítója. Ez kerül az `externalPostId` mezőbe. */
  id: string;
  /** Mikor jelent meg. Ez kerül a `sentAt` mezőbe. */
  createdAt: Date;
  url?: string;
}

export interface KnownItem {
  id: string;
  /** Amit a táblánk ma tud: null, ha nálunk még nem ment ki. */
  externalPostId: string | null;
}

export type SentReconciliation =
  | {
      kind: "incomplete";
      /** Miért nem használható: a hívó nem járta végig a lapozót. */
      reason: string;
    }
  | {
      kind: "ready";
      /** Amit meg kell jelölni kiküldöttként. */
      toMarkSent: { itemId: string; post: ExternalPost }[];
      /**
       * Külső posztok, amikhez nálunk nincs tétel. NEM hiba: a legtöbb régi
       * poszt még azelőttről való, hogy ez a tábla létezett volna.
       */
      unmatched: ExternalPost[];
    };

/**
 * A PÁROSÍTÁS A HÍVÓTÓL JÖN, NEM ITT KELETKEZIK.
 *
 * Ez a függvény nem találgat: nem próbál szöveg vagy dátum alapján párt
 * keresni. Egy „valószínűleg ez az" párosítás egy kiküldött posztot jelölne
 * meg egy MÁSIK tételen, és azt utólag senki nem venné észre. A hívó vagy tudja
 * a párt (mert ő ütemezte), vagy a poszt párosítatlan marad.
 */
export function reconcileSent(input: {
  posts: readonly ExternalPost[];
  /** Igaz, ha a hívó a lapozót VÉGIGJÁRTA. */
  complete: boolean;
  /** Tételenként: melyik külső poszt tartozik hozzá, ha a hívó tudja. */
  pairings: readonly { itemId: string; postId: string }[];
  known: readonly KnownItem[];
}): SentReconciliation {
  if (!input.complete) {
    return {
      kind: "incomplete",
      reason:
        "A külső lekérdezés lapozóját nem járta végig a hívó, tehát a lista hiányos lehet. Egy hiányzó poszt ugyanúgy néz ki, mint egy ki nem küldött, ezért ebből nem jelölünk semmit.",
    };
  }

  const postsById = new Map(input.posts.map((post) => [post.id, post]));
  const knownById = new Map(input.known.map((item) => [item.id, item]));
  const pairedPostIds = new Set<string>();

  const toMarkSent: { itemId: string; post: ExternalPost }[] = [];
  for (const pairing of input.pairings) {
    const post = postsById.get(pairing.postId);
    if (!post) continue;
    pairedPostIds.add(post.id);

    // AMI MÁR MEG VAN JELÖLVE, AZT NEM JELÖLJÜK ÚJRA. A `sentAt` a kiküldés
    // ideje, nem a legutóbbi lekérdezésé: egy ismételt írás minden futásnál
    // odébb tolná, és a lista sorrendje a lekérdezéseinket mutatná, nem a
    // valóságot.
    const item = knownById.get(pairing.itemId);
    if (!item || item.externalPostId !== null) continue;

    toMarkSent.push({ itemId: pairing.itemId, post });
  }

  return {
    kind: "ready",
    toMarkSent,
    unmatched: input.posts.filter((post) => !pairedPostIds.has(post.id)),
  };
}
