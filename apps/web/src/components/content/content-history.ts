import type {
  ContentChannel,
  ContentDetail,
  ContentStateEvent,
} from "@acropora/types";

import { formatDateTimeHu } from "@/lib/format/date";

import { CONTENT_STATE_LABELS } from "./content-labels";

/**
 * A TARTALOM ÁLLAPOT-NAPLÓJA EMBERI ALAKBAN (T5.1, kártya db640e6a; korall specifikációja 6. pont): egy sor egy váltás.
 *
 *   [dátum, idő] [ki]: [régi állapot] → [új állapot], „[indok, ha volt]"
 *   [dátum, idő] [ki]: létrehozta ([állapot])                         (a létrehozásnál nincs honnan)
 *
 * A „ki" a hivatalos név, ha megvan; a törölt felhasználónál az azonosító, hogy a sor ne maradjon név nélkül, és ha az
 * sincs, „ismeretlen". Az állapot felirata a lista felirata (`CONTENT_STATE_LABELS`), nem egy második fordítás.
 */
export function describeContentEvent(event: ContentStateEvent): string {
  const who = event.actorName ?? event.actorUserId ?? "ismeretlen";
  const when = formatDateTimeHu(event.createdAt);
  const to = CONTENT_STATE_LABELS[event.toState] ?? event.toState;
  const step =
    event.fromState === null
      ? `létrehozta (${to})`
      : `${CONTENT_STATE_LABELS[event.fromState] ?? event.fromState} → ${to}`;
  return `${when} ${who}: ${step}${event.note?.trim() ? `, „${event.note.trim()}”` : ""}`;
}

const CHANNEL_LABELS: Record<ContentChannel, string> = {
  FACEBOOK_POST: "Facebook poszt",
  FACEBOOK_AD: "Facebook hirdetés",
  ARTICLE: "Cikk",
  OTHER: "Egyéb",
};

/**
 * A „KIMENT" SOR: MIKOR ÉS HOVÁ (spec 2. pont: a kiment állapotnál rögzíteni kell, hová ment és mikor). A hová a tétel
 * csatornája, a mikor a naplóból az utolsó „kiküldve" váltás ideje; ha a naplóban nincs ilyen (a napló bevezetése előtt
 * küldték ki), a `sentAt` mező, ha van, különben csak annyi áll, hogy kiment, és az időpontot nem ismerjük.
 *
 * Nem kiküldött tételnél null: ott nincs mit mondani.
 */
export function describeContentSent(
  detail: Pick<ContentDetail, "state" | "channel" | "history" | "sentAt">,
): string | null {
  if (detail.state !== "SENT") return null;
  const channel = CHANNEL_LABELS[detail.channel] ?? detail.channel;
  const logged = [...detail.history]
    .reverse()
    .find((event) => event.toState === "SENT");
  const at = logged?.createdAt ?? detail.sentAt ?? null;
  return at
    ? `Kiment: ${formatDateTimeHu(at)} · ${channel}`
    : `Kiment: ${channel} (az időpontot nem ismerjük: a napló bevezetése előtt történt)`;
}
