"use client";

import type { ConversationListItem, MessageItem } from "@acropora/types";
import { Icon, Textarea } from "@acropora/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
} from "react";

import { messagesApi } from "@/lib/api/messages";

import { Monogram, conversationName } from "./conversation-parts";
import { useMessageStream } from "./message-stream";
import {
  dayDividerLabel,
  mergeMessages,
  newClientMessageId,
  visibleOutgoing,
  type OutboxAction,
  type OutgoingMessage,
} from "./outbox";

/** Ennyi pixelen belül a lap alja "lent" van: új üzenetnél oda görgetünk. */
const NEAR_BOTTOM_PX = 120;

/**
 * Enter küld, Shift+Enter új sort ír (a prompt 7. pontja). Magyar ékezetes
 * gépelésnél a szövegszerkesztő (IME) Enterje nem küld.
 */
export function composerKeyAction(
  event: Pick<KeyboardEvent, "key" | "shiftKey"> & { isComposing?: boolean },
): "send" | "newline" | null {
  if (event.key !== "Enter" || event.isComposing) return null;
  return event.shiftKey ? "newline" : "send";
}

/**
 * EGY BESZÉLGETÉS (Figma 441:27, jobb oszlop). Felfelé görgetve a régebbi
 * oldalakat tölti; új üzenet érkezésekor csak akkor görget le, ha a felhasználó
 * amúgy is lent volt (a prompt 28. pontja).
 */
export function ConversationView({
  token,
  viewerId,
  conversation,
  outbox,
  dispatch,
  onChanged,
}: {
  token: string;
  viewerId: string;
  conversation: ConversationListItem;
  outbox: readonly OutgoingMessage[];
  dispatch: Dispatch<OutboxAction>;
  onChanged: () => void;
}) {
  const id = conversation.id;
  const [items, setItems] = useState<MessageItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffset = useRef<number | null>(null);
  const lastMarked = useRef<string | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const page = await messagesApi.page(token, id);
      setItems((current) => mergeMessages(current, page.items));
      setOlderCursor((current) => current ?? page.olderCursor);
      setError(null);
    } catch {
      setError("Az üzenetek nem töltődtek be.");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    setItems([]);
    setOlderCursor(null);
    setLoading(true);
    stickToBottom.current = true;
    lastMarked.current = null;
    void loadLatest();
  }, [loadLatest]);

  useMessageStream((signal) => {
    if (
      signal.type === "resync" ||
      (signal.type === "message.created" && signal.conversationId === id)
    )
      void loadLatest();
  });

  // OLVASOTT: a legutolsó MÁS által küldött üzenet, ha a lap látszik és fókuszban van
  useEffect(() => {
    const latest = [...items]
      .reverse()
      .find((m) => m.senderUserId !== viewerId);
    if (!latest || latest.id === lastMarked.current) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus())
        return;
      lastMarked.current = latest.id;
      void messagesApi
        .markRead(token, id, latest.id)
        .then(() => onChanged())
        .catch(() => {
          lastMarked.current = null;
        });
    };
    mark();
    window.addEventListener("focus", mark);
    return () => window.removeEventListener("focus", mark);
  }, [id, items, onChanged, token, viewerId]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (keepOffset.current !== null) {
      node.scrollTop = node.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stickToBottom.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [items, outbox]);

  const loadOlder = async () => {
    const node = scroller.current;
    if (!olderCursor || !node) return;
    const cursor = olderCursor;
    setOlderCursor(null);
    try {
      const page = await messagesApi.page(token, id, cursor);
      keepOffset.current = node.scrollHeight - node.scrollTop;
      setItems((current) => mergeMessages(current, page.items));
      setOlderCursor(page.olderCursor);
    } catch {
      setOlderCursor(cursor);
    }
  };

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    stickToBottom.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM_PX;
    if (node.scrollTop < 80) void loadOlder();
  };

  const deliver = async (message: OutgoingMessage) => {
    try {
      const sent = await messagesApi.send(
        token,
        id,
        message.text,
        message.clientMessageId,
      );
      setItems((current) => mergeMessages(current, [sent]));
      dispatch({ type: "removed", clientMessageId: message.clientMessageId });
      onChanged();
    } catch {
      dispatch({ type: "failed", clientMessageId: message.clientMessageId });
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const message: OutgoingMessage = {
      clientMessageId: newClientMessageId(),
      conversationId: id,
      text,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "queued", message });
    setDraft("");
    stickToBottom.current = true;
    void deliver(message);
  };

  const retry = (message: OutgoingMessage) => {
    dispatch({ type: "retried", clientMessageId: message.clientMessageId });
    void deliver(message);
  };

  const now = new Date();
  const pending = visibleOutgoing(outbox, id, items);
  const name = conversationName(conversation);

  return (
    <section
      aria-label={`Beszélgetés: ${name}`}
      className="flex min-h-0 flex-1 flex-col border border-pilot-grey-200 bg-white"
    >
      <header className="flex items-center gap-3 border-b border-pilot-grey-200 px-5 py-4">
        <Monogram name={name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-pilot-grey-900">
            {name}
          </p>
          {conversation.type === "GROUP" ? (
            <p className="text-xs text-pilot-grey-500">
              {conversation.members.length + 1} tag
            </p>
          ) : null}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5"
        data-testid="message-list"
      >
        {loading ? (
          <p className="text-center text-sm text-pilot-grey-500">Betöltés…</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-center text-sm text-pilot-red-700">
            {error}
          </p>
        ) : null}
        {!loading && !error && items.length === 0 && pending.length === 0 ? (
          <p className="text-center text-sm text-pilot-grey-500">
            Még nincs üzenet. Írj elsőként!
          </p>
        ) : null}
        {items.map((message, index) => {
          const previous = items[index - 1];
          const divider = dayDividerLabel(message.createdAt, now);
          const showDivider =
            !previous || dayDividerLabel(previous.createdAt, now) !== divider;
          const own = message.senderUserId === viewerId;
          return (
            <div key={message.id}>
              {showDivider ? (
                <p className="py-2 text-center text-xs text-pilot-grey-500">
                  {divider}
                </p>
              ) : null}
              <Bubble
                own={own}
                sender={
                  conversation.type === "GROUP" && !own
                    ? message.senderName
                    : null
                }
                text={
                  message.deleted
                    ? "Az üzenetet törölték."
                    : (message.text ?? "")
                }
                muted={message.deleted}
                time={message.createdAt}
                edited={message.editedAt !== null}
              />
            </div>
          );
        })}
        {pending.map((message) => (
          <div key={message.clientMessageId}>
            <Bubble
              own
              text={message.text}
              time={message.createdAt}
              status={message.status}
            />
            {message.status === "failed" ? (
              <p className="mt-1 flex justify-end gap-3 text-xs" role="alert">
                <span className="text-pilot-red-700">
                  Nem sikerült elküldeni.
                </span>
                <button
                  type="button"
                  className="font-medium text-pilot-aqua-700 underline"
                  onClick={() => retry(message)}
                >
                  Újra
                </button>
                <button
                  type="button"
                  className="font-medium text-pilot-grey-600 underline"
                  onClick={() =>
                    dispatch({
                      type: "removed",
                      clientMessageId: message.clientMessageId,
                    })
                  }
                >
                  Törlés
                </button>
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <form
        className="flex items-end gap-3 border-t border-pilot-grey-200 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Üzenet</span>
          <Textarea
            value={draft}
            rows={1}
            maxLength={4000}
            placeholder="Írj egy üzenetet…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                composerKeyAction({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                }) === "send"
              ) {
                event.preventDefault();
                send();
              }
            }}
            className="max-h-40 min-h-11 resize-none"
          />
        </label>
        <button
          type="submit"
          aria-label="Küldés"
          disabled={!draft.trim()}
          className="flex size-11 shrink-0 items-center justify-center bg-pilot-aqua-700 text-white disabled:opacity-40"
        >
          <Icon name="send" size={18} />
        </button>
      </form>
    </section>
  );
}

function Bubble({
  own,
  sender = null,
  text,
  time,
  muted = false,
  edited = false,
  status,
}: {
  own: boolean;
  sender?: string | null;
  text: string;
  time: string;
  muted?: boolean;
  edited?: boolean;
  status?: OutgoingMessage["status"];
}) {
  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] px-4 py-3 text-sm ${
          own
            ? "bg-pilot-aqua-50 text-pilot-grey-900"
            : "bg-pilot-grey-100 text-pilot-grey-900"
        } ${status === "failed" ? "border border-pilot-red-700" : ""}`}
        data-status={status ?? "sent"}
      >
        {sender ? (
          <p className="mb-1 text-xs font-medium text-pilot-aqua-700">
            {sender}
          </p>
        ) : null}
        <p
          className={`whitespace-pre-wrap break-words ${muted ? "italic text-pilot-grey-500" : ""}`}
        >
          {text}
        </p>
        <p className="mt-1 text-xs text-pilot-grey-500">
          {new Date(time).toLocaleTimeString("hu-HU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {edited ? " · szerkesztve" : ""}
          {status === "pending" ? " · küldés…" : ""}
        </p>
      </div>
    </div>
  );
}
