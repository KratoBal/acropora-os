"use client";

import type { ConversationListItem } from "@acropora/types";
import { Icon, Input } from "@acropora/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { messagesApi } from "@/lib/api/messages";

import { ConversationRow, conversationName } from "./conversation-parts";
import { ConversationView } from "./conversation-view";
import { useMessageStream, useMessagesEnabled } from "./message-stream";
import { NewConversationDialog } from "./new-conversation-dialog";
import { outboxReducer } from "./outbox";

/**
 * AZ ÜZENETEK (kártya 51d7aba0, Figma 441:27). Bal oldalt a beszélgetések,
 * jobbra a kiválasztott. A kiválasztás az URL-ben él (`?c=`), így egy link és a
 * böngésző "vissza" gombja is ugyanoda visz.
 */
export function MessagesPage() {
  const { session } = useAuth();
  const enabled = useMessagesEnabled();
  const token = session?.token ?? "";
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("c");

  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outbox, dispatch] = useReducer(outboxReducer, []);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems((await messagesApi.list(token)).items);
      setError(null);
    } catch {
      setError("A beszélgetések nem töltődtek be.");
    }
  }, [token]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 300);
  }, [reload]);

  useMessageStream(() => scheduleReload());

  const select = (id: string) =>
    router.replace(`${pathname}?c=${encodeURIComponent(id)}`);

  if (!enabled)
    return (
      <p className="text-sm text-pilot-grey-600">
        Az Üzenetek nem érhetők el ezzel a fiókkal.
      </p>
    );

  const now = new Date();
  const needle = filter.trim().toLowerCase();
  const visible = (items ?? []).filter(
    (item) =>
      !needle ||
      conversationName(item).toLowerCase().includes(needle) ||
      (item.lastMessage?.text ?? "").toLowerCase().includes(needle),
  );
  const selected = items?.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold text-pilot-grey-900">Üzenetek</h1>
      <div className="flex min-h-[600px] flex-col gap-6 lg:h-[calc(100vh-12rem)] lg:flex-row">
        <section
          aria-label="Beszélgetések"
          className={`flex min-h-0 flex-col border border-pilot-grey-200 bg-white p-4 lg:w-[360px] lg:shrink-0 ${
            selected ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-pilot-grey-900">
              Beszélgetések
            </h2>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1 bg-pilot-accent-warm px-4 py-2 text-sm font-medium text-white hover:bg-pilot-accent-warm-text"
            >
              <Icon name="plus" size={16} />
              Új üzenet
            </button>
          </div>
          <label className="relative mb-3 block">
            <span className="sr-only">Keresés beszélgetésekben</span>
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-500"
            />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Keresés beszélgetésekben…"
              className="pl-9"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error ? (
              <p role="alert" className="px-2 py-4 text-sm text-pilot-red-700">
                {error}
              </p>
            ) : null}
            {items === null && !error ? (
              <p className="px-2 py-4 text-sm text-pilot-grey-500">Betöltés…</p>
            ) : null}
            {items !== null && visible.length === 0 ? (
              <p className="px-2 py-4 text-sm text-pilot-grey-500">
                {items.length === 0
                  ? "Még nincs beszélgetésed. Indíts egyet az Új üzenet gombbal."
                  : "Nincs találat."}
              </p>
            ) : null}
            {visible.map((item) => (
              <ConversationRow
                key={item.id}
                item={item}
                active={item.id === selectedId}
                now={now}
                onSelect={select}
              />
            ))}
          </div>
        </section>

        {selected && session ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <button
              type="button"
              className="self-start text-sm text-pilot-aqua-700 lg:hidden"
              onClick={() => router.replace(pathname)}
            >
              ← Beszélgetések
            </button>
            <ConversationView
              key={selected.id}
              token={token}
              viewerId={session.user.id}
              conversation={selected}
              outbox={outbox}
              dispatch={dispatch}
              onChanged={scheduleReload}
            />
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center border border-pilot-grey-200 bg-white text-sm text-pilot-grey-500 lg:flex">
            Válassz egy beszélgetést, vagy indíts újat.
          </div>
        )}
      </div>

      {dialogOpen ? (
        <NewConversationDialog
          token={token}
          onClose={() => setDialogOpen(false)}
          onCreated={(conversation) => {
            setDialogOpen(false);
            void reload().then(() => select(conversation.id));
          }}
        />
      ) : null}
    </div>
  );
}
