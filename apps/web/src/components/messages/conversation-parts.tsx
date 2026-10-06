"use client";

import type { ConversationListItem, ConversationPerson } from "@acropora/types";

import { SUTYERAK_ASSETS } from "@/components/assistant/assets";

import { conversationTimeLabel, previewText } from "./outbox";
import { contextSubtitle, isPartnerConversation } from "./phase4";

/** A beszélgetés neve: csoportnál a megadott név, DIRECT-nél a másik tag neve. */
export function conversationName(
  item: Pick<ConversationListItem, "title" | "members">,
): string {
  if (item.title) return item.title;
  const names = item.members.map((m) => m.name);
  return names.length > 0 ? names.join(", ") : "Beszélgetés";
}

/** A monogram: a név első két szavának kezdőbetűje (a Figma 441:9 avatarja). */
export function monogram(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase());
  return letters.join("") || "?";
}

/** Sutyerák válasza, amit acrobot adott (4. pont, B/5): a feladó neve helyén. */
export const SUTYERAK_VIA_ACROBOT = "Sutyerák, Acrobot válaszával";

/** A dolgozó és Sutyerák kettes beszélgetése: a másik tag ő. */
export function isAssistantConversation(
  item: Pick<ConversationListItem, "type" | "members">,
): boolean {
  return (
    item.type === "DIRECT" &&
    item.members.length === 1 &&
    item.members[0]!.kind === "assistant"
  );
}

/** Sutyerák a kollégaválasztó elején, a többiek az API sorrendjében. */
export function assistantFirst<T extends Pick<ConversationPerson, "kind">>(
  people: T[],
): T[] {
  return [
    ...people.filter((person) => person.kind === "assistant"),
    ...people.filter((person) => person.kind !== "assistant"),
  ];
}

export function Monogram({
  name,
  inactive = false,
  assistant = false,
}: {
  name: string;
  inactive?: boolean;
  /** Sutyerák: a monogram helyén a figurája. */
  assistant?: boolean;
}) {
  if (assistant)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- swappable local mascot assets
      <img
        src={SUTYERAK_ASSETS.resting}
        alt=""
        aria-hidden="true"
        width={32}
        height={32}
        data-testid="sutyerak-avatar"
        className="size-8 shrink-0 object-contain"
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center bg-pilot-aqua-50 text-xs font-medium ${
        inactive ? "text-pilot-grey-500" : "text-pilot-aqua-700"
      }`}
    >
      {monogram(name)}
    </span>
  );
}

/** Az utolsó üzenet előnézete a listában: a csoportban a küldő nevével. */
export function lastMessagePreview(item: ConversationListItem): string {
  const last = item.lastMessage;
  if (!last) return "Még nincs üzenet";
  if (last.deleted) return "Az üzenetet törölték.";
  const text = previewText(last);
  return item.type === "GROUP" ? `${last.senderName}: ${text}` : text;
}

export function ConversationRow({
  item,
  active,
  now,
  onSelect,
}: {
  item: ConversationListItem;
  active: boolean;
  now: Date;
  onSelect: (id: string) => void;
}) {
  const name = conversationName(item);
  const inactive =
    item.type === "DIRECT" &&
    item.members.every((m: ConversationPerson) => !m.isActive);
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-start gap-3 px-2 py-3 text-left transition-colors ${
        active ? "bg-pilot-accent-warm-soft" : "hover:bg-pilot-grey-50"
      }`}
    >
      <Monogram
        name={name}
        inactive={inactive}
        assistant={isAssistantConversation(item)}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-pilot-grey-900">
          {name}
          {inactive ? (
            <span className="ml-1 text-xs font-normal text-pilot-grey-500">
              (inaktív)
            </span>
          ) : null}
          {isPartnerConversation(item) ? (
            <span className="ml-2 rounded bg-pilot-accent-warm-soft px-1.5 py-0.5 text-[11px] font-semibold text-pilot-accent-warm-text">
              Partner
            </span>
          ) : null}
        </span>
        {item.contextType ? (
          <span className="block truncate text-xs text-pilot-accent-warm-text">
            {contextSubtitle(item.contextType)}
          </span>
        ) : null}
        <span className="block truncate text-xs text-pilot-grey-600">
          {lastMessagePreview(item)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {item.lastMessageAt ? (
          <span className="text-xs text-pilot-grey-500">
            {conversationTimeLabel(item.lastMessageAt, now)}
          </span>
        ) : null}
        {item.unreadCount > 0 ? (
          <span
            aria-label={`${item.unreadCount} olvasatlan`}
            className="min-w-5 bg-pilot-accent-warm px-1.5 text-center text-xs font-medium text-white"
          >
            {item.unreadCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}
