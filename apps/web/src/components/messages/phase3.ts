import type {
  ConversationNotificationState,
  ConversationNotifyMode,
} from "@acropora/types";

/**
 * AZ ÜZENETEK 3. FÁZISÁNAK TISZTA SZABÁLYAI A WEBEN (terv: uzenetek-3-fazis-terv.md).
 * A képernyőn csak a bekötés marad; ami dönt, az itt mérhető.
 */

const WEEKDAY_NAMES = [
  "vasárnap",
  "hétfő",
  "kedd",
  "szerda",
  "csütörtök",
  "péntek",
  "szombat",
];

const MONTHS = [
  "jan.",
  "febr.",
  "márc.",
  "ápr.",
  "máj.",
  "jún.",
  "júl.",
  "aug.",
  "szept.",
  "okt.",
  "nov.",
  "dec.",
];

const clock = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

/**
 * A FIGMA IDŐ-ALAKJA a találatokban és a kitűzött elemeknél (453:491, 454:578,
 * 454:636): „ma 14:37”, „tegnap 16:12”, a héten a nap neve („péntek”), azon túl
 * a dátum („szept. 30.”). A hónapnevek kézzel állnak: a böngésző és a Node
 * ICU-ja eltérő rövidítést adhat, és a Figma alakja a mérce.
 */
export function shortWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  const day = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days <= 0) return `ma ${clock(date)}`;
  if (days === 1) return `tegnap ${clock(date)}`;
  if (days < 7) return WEEKDAY_NAMES[date.getDay()]!;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}.`;
}

/** „Kovács Anna · ma 14:37” (Figma 453:491). */
export function searchHitMeta(
  hit: { senderName: string; createdAt: string },
  now: Date,
): string {
  return `${hit.senderName} · ${shortWhen(hit.createdAt, now)}`;
}

/** „Üzenet · Balázs · tegnap” (Figma 454:636): az ÜZENET szerzője és ideje. */
export function pinnedMeta(
  item: { senderName: string; messageCreatedAt: string },
  now: Date,
): string {
  return `Üzenet · ${item.senderName} · ${shortWhen(item.messageCreatedAt, now)}`;
}

/** A találatszám a Figma alakjában („3 találat”), a korlátnál „1000+”. */
export function searchCountLabel(total: number, capped: boolean): string {
  return `${total}${capped ? "+" : ""} találat`;
}

/**
 * AZ ÉRTESÍTÉSI BEÁLLÍTÁS FELIRATA (Figma 450:260: „Minden új üzenetről”). A
 * lejárt némítás nem némítás: a szerver `null`-t ad rá, de a kliens órája is
 * továbbléphetett a betöltés óta.
 */
export function notificationLabel(
  state: ConversationNotificationState | undefined,
  now: Date,
): string {
  const until = state?.mutedUntil ? new Date(state.mutedUntil) : null;
  if (until && until.getTime() > now.getTime()) {
    const sameDay = until.toDateString() === now.toDateString();
    return `Némítva ${sameDay ? "" : "holnap "}${clock(until)}-ig`;
  }
  if (state?.notify === "NONE") return "Nincs értesítés";
  return "Minden új üzenetről";
}

/**
 * A BEÁLLÍTÁS VÁLASZTHATÓ MÓDJAI (Figma 450:630, Balázs 2026-10-05: a „Csak
 * említések” most NINCS). A némítás feloldása csak akkor kell, ha van mit
 * feloldani.
 */
export function notificationOptions(
  state: ConversationNotificationState | undefined,
  now: Date,
): { mode: ConversationNotifyMode; label: string; hint: string }[] {
  const muted =
    !!state?.mutedUntil && new Date(state.mutedUntil).getTime() > now.getTime();
  return [
    { mode: "ALL", label: "Minden új üzenet", hint: "Ajánlott" },
    { mode: "MUTE_1H", label: "Némítás 1 órára", hint: "Ideiglenesen" },
    {
      mode: "MUTE_UNTIL_MORNING",
      label: "Némítás holnapig",
      hint: "Reggel 8 óráig",
    },
    ...(muted
      ? [
          {
            mode: "UNMUTE" as const,
            label: "Némítás feloldása",
            hint: "Újra kapsz értesítést",
          },
        ]
      : []),
  ];
}

/**
 * A MŰVELETI MENÜ JOGAI egy üzeneten (Figma 453:244). A továbbítás és a
 * kitűzés bárkié (Balázs, 2026-10-05), a szerkesztés és a törlés csak a
 * sajátodé (acrobot 26174). Törölt üzeneten nincs menü.
 */
export function messageActions(input: {
  own: boolean;
  deleted: boolean;
  pinned: boolean;
  hasText: boolean;
}): ("reply" | "copy" | "forward" | "pin" | "unpin" | "edit" | "delete")[] {
  if (input.deleted) return [];
  return [
    "reply",
    ...(input.hasText ? (["copy"] as const) : []),
    "forward",
    input.pinned ? "unpin" : "pin",
    ...(input.own ? (["edit", "delete"] as const) : []),
  ];
}

/** „PDF”, „XLSX”: a kiterjesztés nagybetűvel (Figma 450:549: „PDF · 1,2 MB”). */
export function fileTypeLabel(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1
    ? fileName.slice(dot + 1).toUpperCase()
    : "Fájl";
}
