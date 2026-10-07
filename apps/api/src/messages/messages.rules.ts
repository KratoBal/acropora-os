import {
  hasPermission,
  MESSAGE_TEXT_MAX_LENGTH,
  permissionsWithOverrides,
  PERMISSIONS,
  type UserRole,
} from "@acropora/types";

/**
 * AZ ÜZENETEK MODUL TISZTA SZABÁLYAI (kártya 51d7aba0). Adatbázis nélkül
 * mérhetők, és a szolgáltatás ezekből dönt.
 */

/**
 * KÉT EMBER KÖZÖTT EGY DIRECT BESZÉLGETÉS. A kulcs a két azonosító rendezve, így
 * a sorrend nem számít; az egyediség az adatbázisban áll (`Conversation.directKey`).
 */
export function directKeyOf(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export interface MessagingCandidate {
  role: UserRole;
  isActive: boolean;
  customerId: string | null;
  supplierId: string | null;
  /**
   * A személyes jog-eltérései (`UserPermissionOverride`). A repository mindig
   * betölti (`USER_SELECT`); hiányukban a szerep sablonja dönt.
   */
  permissionOverrides?: readonly { permission: string; effect: string }[];
}

/**
 * LEHET-E TAGJA EGY BELSŐ (`INTERNAL`) BESZÉLGETÉSNEK.
 *
 * Három feltétel, és mind a három kell:
 *   - aktív fiók (deaktivált kollégával új beszélgetés nem indul, és nem vehető fel);
 *   - a szerepköre megkapja a `messages.use` jogot (gépi ágens és partnerfiók nem);
 *   - nincs partnerhez kötve (`customerId`, `supplierId`).
 *
 * A harmadik NEM ismétli a másodikat: egy belső szerepkörű fiók is kaphat
 * partner-kötést, és akkor a partner nevében lép be. Egy belső beszélgetés
 * szövege neki sem látszhat (acrobot 26171, 38/9).
 */
export function mayJoinInternal(user: MessagingCandidate): boolean {
  return (
    user.isActive &&
    user.customerId === null &&
    user.supplierId === null &&
    hasPermission(
      {
        role: user.role,
        permissions: permissionsWithOverrides(
          user.role,
          user.permissionOverrides ?? [],
        ),
      },
      PERMISSIONS.MESSAGES_USE,
    )
  );
}

/** A küldendő szöveg: levágott szélekkel; üresen `null`. A hossz-korlátot a DTO tartja. */
export function cleanMessageText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export { MESSAGE_TEXT_MAX_LENGTH };

/**
 * A KURZOR: egy üzenet `(createdAt, id)` párja, átlátszatlan szövegként. A
 * rendezés is erre a párra megy, tehát két azonos pillanatban keletkezett üzenet
 * sem ismétlődik és nem marad ki a lapozásnál.
 */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const bar = raw.indexOf("|");
  if (bar <= 0) return null;
  const createdAt = new Date(raw.slice(0, bar));
  const id = raw.slice(bar + 1);
  return Number.isNaN(createdAt.getTime()) || !id ? null : { createdAt, id };
}

const PUSH_BODY_MAX = 140;

/**
 * A PUSH SZÖVEGE. DIRECT-nél a küldő neve a cím és az üzenet a törzs (a prompt
 * 20. pontjának példája); csoportnál a csoport neve a cím, és a törzs elé kerül
 * a küldő neve.
 */
export function messagePushText(input: {
  conversationTitle: string | null;
  senderName: string;
  text: string;
}): { title: string; body: string } {
  const text =
    input.text.length > PUSH_BODY_MAX
      ? `${input.text.slice(0, PUSH_BODY_MAX - 1)}…`
      : input.text;
  return input.conversationTitle
    ? { title: input.conversationTitle, body: `${input.senderName}: ${text}` }
    : { title: input.senderName, body: text };
}

/**
 * KI KAP PUSHT egy új üzenetről: a beszélgetés aktív tagjai, a küldőn kívül,
 * és aki nincs elnémítva. A beállítás felülete a 3. fázisban jön, az oszlop és a
 * szabály már most él.
 */
export function pushRecipients(input: {
  senderUserId: string;
  now: Date;
  members: readonly {
    userId: string;
    leftAt: Date | null;
    notify: "ALL" | "MENTIONS" | "NONE";
    mutedUntil: Date | null;
  }[];
}): string[] {
  return input.members
    .filter(
      (m) =>
        m.userId !== input.senderUserId &&
        m.leftAt === null &&
        m.notify === "ALL" &&
        !(m.mutedUntil && m.mutedUntil > input.now),
    )
    .map((m) => m.userId);
}

/** A szöveg nélküli csatolmány előnézete (a prompt 20. pontja): a listában és a pushban. */
export function attachmentPreview(kind: "IMAGE" | "FILE"): string {
  return kind === "IMAGE" ? "📷 Képet küldött" : "📎 Fájlt küldött";
}

/** Az üzenet típusa a csatolmányokból: kép, ha mind kép; fájl, ha bármelyik nem az. */
export function messageTypeFor(
  kinds: readonly ("IMAGE" | "FILE")[],
): "TEXT" | "IMAGE" | "FILE" {
  if (kinds.length === 0) return "TEXT";
  return kinds.every((kind) => kind === "IMAGE") ? "IMAGE" : "FILE";
}

/** A gazdátlan feltöltés ennyi idő után törölhető (acrobot 26242, emlék 2076). */
export const ORPHAN_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

/** A bélyegkép dokumentum-azonosítója a tárolóban, az eredeti mellett. */
export const thumbnailDocumentId = (attachmentId: string) =>
  `${attachmentId}-thumb`;

/**
 * A KERESÉS MINTÁJA (3. fázis, prompt 13. pont). Az `ILIKE` maga a `%` és a
 * `_` jelet joker-karakternek veszi, ezért a felhasználó szövegében ezeket
 * (és magát a `\` jelet) escape-eljük: a „100%” keresés a „100%” szövegre
 * illeszkedjen, ne minden „100”-ra. Az ügyfélkereső mintája
 * (`customerSearchPattern`), az ékezet-függetlenséget a lekérdezés adja.
 */
export function messageSearchPattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Egy karakter összehasonlítható alakja: kisbetű, ékezet nélkül („Ő” → „o”). */
const foldChar = (char: string): string =>
  char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const SNIPPET_RADIUS = 40;

/**
 * A TALÁLAT KÖRNYEZETE A LISTÁBAN (Figma 453:491: „…megérkezett már a Zoo-s
 * pumpa?”). Ugyanúgy ékezet- és kisbetű-függetlenül keres, mint az adatbázis,
 * különben egy „kotel” keresés találatánál a szöveg elejét mutatnánk a
 * „kötél” helyett. Ha a szövegben (pl. egy egyedi írásjel miatt) mégsem
 * található, a szöveg eleje megy.
 */
export function searchSnippet(
  text: string,
  query: string,
  radius = SNIPPET_RADIUS,
): string {
  const chars = [...text];
  const folded = chars.map(foldChar);
  const needle = [...query.trim()].map(foldChar).join("");
  let at = -1;
  if (needle) {
    for (let start = 0; start < folded.length && at < 0; start += 1) {
      let joined = "";
      for (
        let end = start;
        end < folded.length && joined.length < needle.length;
        end += 1
      )
        joined += folded[end];
      if (joined.startsWith(needle)) at = start;
    }
  }
  const flat = (part: string[]) => part.join("").replace(/\s+/g, " ").trim();
  if (at < 0)
    return chars.length > radius * 2
      ? `${flat(chars.slice(0, radius * 2))}…`
      : flat(chars);
  const from = Math.max(0, at - radius);
  const to = Math.min(chars.length, at + [...query.trim()].length + radius);
  return `${from > 0 ? "…" : ""}${flat(chars.slice(from, to))}${to < chars.length ? "…" : ""}`;
}

const BUDAPEST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const budapestParts = (at: Date) => {
  const parts = Object.fromEntries(
    BUDAPEST_PARTS.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
};

/** Egy budapesti fali óra szerinti időpont UTC-ben, a nyári és a téli időre is. */
function budapestWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, 0);
  let guess = wanted;
  // két kör elég: az első az eltolást, a második az átállás napját igazítja
  for (let round = 0; round < 2; round += 1) {
    const seen = budapestParts(new Date(guess));
    guess +=
      wanted -
      Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  return new Date(guess);
}

/**
 * A „NÉMÍTÁS HOLNAPIG” VÉGE: a KÖVETKEZŐ reggel 8 óra, budapesti idő szerint
 * (Balázs döntése, 2026-10-05 15:07 UTC, acrobot 26415: „Elfogadom” a „másnap
 * reggel 8 óráig” javaslatra). Éjfélig nem, mert akkor éjjel jönnének az
 * értesítések. Éjfél és reggel 8 között a „másnap” a MAI reggel: 00:30-kor a
 * szándék a reggelig tartó csend, nem egy 31 órás némítás.
 */
export const MUTE_UNTIL_MORNING_HOUR = 8;

/**
 * EGY ÉRTESÍTÉSI MÓD HATÁSA a tagság két oszlopára (prompt 17. pont). A
 * `notify` csak a „Minden új üzenet” választásnál változik (és ott a némítás is
 * megszűnik); a némítások a meglévő `notify` értéket hagyják, csak a
 * `mutedUntil`-t írják. Az idő a szerveré, nem a kliensé.
 */
export function notificationUpdate(
  mode: "ALL" | "MUTE_1H" | "MUTE_UNTIL_MORNING" | "UNMUTE",
  now: Date,
): { notify?: "ALL"; mutedUntil: Date | null } {
  switch (mode) {
    case "ALL":
      return { notify: "ALL", mutedUntil: null };
    case "UNMUTE":
      return { mutedUntil: null };
    case "MUTE_1H":
      return { mutedUntil: new Date(now.getTime() + 60 * 60 * 1000) };
    case "MUTE_UNTIL_MORNING": {
      const today = budapestParts(now);
      const morning = (dayOffset: number) => {
        const day = new Date(
          Date.UTC(today.year, today.month - 1, today.day + dayOffset),
        );
        return budapestWallTime(
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          MUTE_UNTIL_MORNING_HOUR,
        );
      };
      const todays = morning(0);
      return {
        mutedUntil: todays.getTime() > now.getTime() ? todays : morning(1),
      };
    }
  }
}

/**
 * A kapcsolt objektum neve a mondatokban (4. fázis), a ragos alakok KIÍRVA: a
 * hangrend miatt a „munkalap” „-hoz”, „-ról”, a „hibajegy” „-hez”, „-ről”.
 */
export const CONTEXT_NOUN = {
  WORKSHEET: { to: "munkalaphoz", from: "munkalapról" },
  SERVICE_JOB: { to: "hibajegyhez", from: "hibajegyről" },
} as const;

/**
 * A 4. FÁZIS RENDSZERÜZENETEI (Figma 450:710). A neveket NEM ragozzuk: a
 * „Dánielt”, „Annát” alakot gépi úton nem lehet biztonságosan előállítani, és
 * egy rossz rag rosszabb, mint egy kettőspont. Ezért a név a mondat alanya,
 * vagy kettőspont után áll.
 */
export const systemText = {
  started: (actor: string, type: keyof typeof CONTEXT_NOUN, ref: string) =>
    `${actor} beszélgetést indított ehhez a ${CONTEXT_NOUN[type].to}: ${ref}.`,
  linked: (actor: string, type: keyof typeof CONTEXT_NOUN, ref: string) =>
    `${actor} ehhez a ${CONTEXT_NOUN[type].to} kapcsolta a beszélgetést: ${ref}.`,
  unlinked: (actor: string, type: keyof typeof CONTEXT_NOUN, ref: string) =>
    `${actor} leválasztotta a beszélgetést erről a ${CONTEXT_NOUN[type].from}: ${ref}.`,
  added: (actor: string, names: readonly string[]) =>
    `${actor} új ${names.length > 1 ? "tagokat" : "tagot"} adott hozzá: ${names.join(", ")}.`,
  joined: (actor: string) => `${actor} csatlakozott a beszélgetéshez.`,
  left: (actor: string) => `${actor} kilépett a beszélgetésből.`,
};

/** A kapcsolt objektum hivatkozása a mondatban: a száma, vagy szám nélkül a fajtája. */
export function contextRef(number: string | null | undefined): string {
  return number?.trim() || "szám nélküli";
}

/** Az ékezet, a kisbetű és a szóköz nélküli alak: a név keresése ettől független. */
const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Benne van-e a szövegben Sutyerák neve (ékezettől és kis-nagybetűtől
 * függetlenül). Csak ELÖL kell szóhatár: a magyar toldalék a név mögé tapad
 * („Sutyeráknak”, „Sutyerákkal”), és az is megszólítás.
 */
export function mentionsSutyerak(text: string | null): boolean {
  return !!text && /(?<!\p{L})sutyerak/u.test(folded(text));
}

/** Amit Sutyerák a csak csatolmányt hozó üzenetre mond (4. pont B, 4. tétel). */
export const SUTYERAK_ATTACHMENT_ONLY =
  "Ezt a csatolmányt még nem tudom elolvasni. Írd le szövegben, mit szeretnél tudni, és megnézem.";

/**
 * MIKOR VÁLASZOL SUTYERÁK (4. pont B, 2. tétel): kettes beszélgetésben minden
 * üzenetre, csoportban csak akkor, ha a szöveg a nevét említi. A saját, a
 * törölt és a rendszer-üzenetre soha. Csak csatolmányra (szöveg nélkül) egy
 * mondattal felel, hogy azt még nem tudja olvasni; csoportban az ilyen
 * üzenet nem említi, tehát ott hallgat.
 */
export function assistantReplyPlan(input: {
  assistantUserId: string;
  senderUserId: string;
  conversationType: "DIRECT" | "GROUP";
  /** A beszélgetés JELENLEGI tagjai, Sutyerákkal együtt. */
  activeMemberIds: readonly string[];
  type: string;
  text: string | null;
  attachmentCount: number;
  deleted: boolean;
}):
  | { kind: "ASK"; question: string; group: boolean }
  | { kind: "ATTACHMENT_ONLY" }
  | null {
  if (input.senderUserId === input.assistantUserId) return null;
  if (input.deleted || input.type === "SYSTEM") return null;
  if (!input.activeMemberIds.includes(input.assistantUserId)) return null;
  const group = input.conversationType === "GROUP";
  const text = input.text?.trim() || null;
  if (group && !mentionsSutyerak(text)) return null;
  if (text) return { kind: "ASK", question: text.slice(0, 4000), group };
  return input.attachmentCount > 0 ? { kind: "ATTACHMENT_ONLY" } : null;
}
