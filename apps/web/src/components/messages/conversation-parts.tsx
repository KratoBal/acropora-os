"use client";

import type { ConversationListItem, ConversationPerson } from "@acropora/types";

import { conversationTimeLabel, previewText } from "./outbox";

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

export function Monogram({
  name,
  inactive = false,
}: {
  name: string;
  inactive?: boolean;
}) {
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
      <Monogram name={name} inactive={inactive} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-pilot-grey-900">
          {name}
          {inactive ? (
            <span className="ml-1 text-xs font-normal text-pilot-grey-500">
              (inaktív)
            </span>
          ) : null}
        </span>
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
