"use client";

import {
  MESSAGE_REACTIONS,
  type ConversationContextCard,
  type ConversationListItem,
  type MessageItem,
} from "@acropora/types";
import { ConfirmDialog, Icon, Textarea } from "@acropora/ui";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
} from "react";

import {
  attachmentUrl,
  messagesApi,
  uploadMessageAttachment,
} from "@/lib/api/messages";

import {
  ConversationDetailsPanel,
  ForwardDialog,
  SearchAndPinsPanel,
} from "./conversation-drawer";
import { Monogram, conversationName } from "./conversation-parts";
import { useMessageStream } from "./message-stream";
import {
  contextCardParts,
  contextCardTitle,
  contextHref,
  contextSubtitle,
  isSystemMessage,
} from "./phase4";
import {
  canSend,
  dayDividerLabel,
  fileSizeLabel,
  mergeMessages,
  newClientMessageId,
  previewText,
  readyAttachmentIds,
  uploadsReducer,
  visibleOutgoing,
  type OutboxAction,
  type OutgoingMessage,
} from "./outbox";
import { messageActions } from "./phase3";

/** A műveleti menü feliratai (Figma 453:244). */
const ACTION_LABELS = {
  reply: "Válasz",
  copy: "Másolás",
  forward: "Továbbítás",
  pin: "Kitűzés",
  unpin: "Kitűzés levétele",
  edit: "Szerkesztés",
  delete: "Üzenet törlése",
} as const;

/** Az „Ugrás” után ennyi ideig marad kiemelve a megtalált üzenet. */
const HIGHLIGHT_MS = 2500;

/** Ennyi pixelen belül a lap alja "lent" van: új üzenetnél oda görgetünk. */
const NEAR_BOTTOM_PX = 120;

/** A böngészőben is ugyanaz a keret, mint a szerveren: 10 MB, PDF, JPEG, PNG. */
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png";

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
 * EGY BESZÉLGETÉS (Figma 441:27 és 453:287). Felfelé görgetve a régebbi
 * oldalakat tölti; új üzenet érkezésekor csak akkor görget le, ha a felhasználó
 * amúgy is lent volt (a prompt 28. pontja). A 2. fázis óta: válasz, reakció,
 * szerkesztés, törlés, és fájlonként feltöltött csatolmány.
 */
export function ConversationView({
  token,
  viewerId,
  conversation,
  outbox,
  dispatch,
  onChanged,
  onLeft,
}: {
  token: string;
  viewerId: string;
  conversation: ConversationListItem;
  outbox: readonly OutgoingMessage[];
  dispatch: Dispatch<OutboxAction>;
  onChanged: () => void;
  /** 4. fázis: a néző kilépett a csoportból; a lap visszamegy a listára. */
  onLeft?: () => void;
}) {
  const id = conversation.id;
  const [items, setItems] = useState<MessageItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MessageItem | null>(null);
  const [uploads, dispatchUpload] = useReducer(uploadsReducer, []);
  const uploadJobs = useRef(
    new Map<string, { file: File; abort: AbortController }>(),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffset = useRef<number | null>(null);
  const lastMarked = useRef<string | null>(null);
  // --- a 3. fázis: oldalsó fiók, ugrás, továbbítás
  const [drawer, setDrawer] = useState<"search" | "details" | null>(null);
  const [pinsVersion, setPinsVersion] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<{
    message: MessageItem;
    clientMessageId: string;
  } | null>(null);
  /**
   * AZ UGRÁS-MÓD: egy régebbi üzenet köré nyitott oldalon ÚJABB üzenetek is
   * vannak még. Amíg tart, egy élő esemény nem fűzi hozzá a legújabbakat (az
   * lyukat hagyna a közepén); lefelé görgetve az újabb oldalak jönnek, és az
   * utolsó után a mód véget ér.
   */
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const jumpMode = useRef(false);
  // --- a 4. fázis: a kapcsolt munkalap vagy hibajegy kártyája
  const [context, setContext] = useState<ConversationContextCard | null>(null);
  const [contextVersion, setContextVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void messagesApi
      .detail(token, id, controller.signal)
      .then((detail) => setContext(detail.context ?? null))
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, token, contextVersion]);

  const loadLatest = useCallback(async () => {
    if (jumpMode.current) return;
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

  const refreshOne = useCallback(
    async (messageId: string) => {
      try {
        const fresh = await messagesApi.message(token, messageId);
        setItems((current) => mergeMessages(current, [fresh]));
      } catch {
        // a következő teljes újraolvasás pótolja
      }
    },
    [token],
  );

  useEffect(() => {
    setItems([]);
    setOlderCursor(null);
    setNewerCursor(null);
    jumpMode.current = false;
    setDrawer(null);
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
    else if (
      signal.type === "message.updated" &&
      signal.conversationId === id
    ) {
      void refreshOne(signal.messageId);
      // egy kitűzés-változás is így jön: a fiók listája újraolvasódik
      setPinsVersion((version) => version + 1);
    }
  });

  // az ugrás célja középre kerül, és rövid ideig kiemelve marad
  useEffect(() => {
    if (!highlight) return;
    document
      .querySelector(`[data-testid="message-${CSS.escape(highlight)}"]`)
      ?.scrollIntoView?.({ block: "center" });
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight, items]);

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

  /** „Ugrás” (keresési találat vagy kitűzött elem): ha már betöltve, csak odagörget. */
  const jumpTo = async (messageId: string) => {
    if (items.some((message) => message.id === messageId)) {
      stickToBottom.current = false;
      setHighlight(messageId);
      return;
    }
    try {
      const page = await messagesApi.around(token, id, messageId);
      jumpMode.current = page.newerCursor != null;
      stickToBottom.current = false;
      setItems(page.items);
      setOlderCursor(page.olderCursor);
      setNewerCursor(page.newerCursor ?? null);
      setHighlight(messageId);
    } catch {
      setNotice("Az üzenet nem érhető el.");
    }
  };

  const loadNewer = async () => {
    if (!newerCursor) return;
    const cursor = newerCursor;
    setNewerCursor(null);
    try {
      const page = await messagesApi.newer(token, id, cursor);
      setItems((current) => mergeMessages(current, page.items));
      const next = page.newerCursor ?? null;
      setNewerCursor(next);
      if (!next) {
        // elértük a jelent: innentől az élő események újra hozzáfűznek
        jumpMode.current = false;
        void loadLatest();
      }
    } catch {
      setNewerCursor(cursor);
    }
  };

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    const fromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickToBottom.current = !jumpMode.current && fromBottom < NEAR_BOTTOM_PX;
    if (node.scrollTop < 80) void loadOlder();
    if (fromBottom < 80) void loadNewer();
  };

  const deliver = async (message: OutgoingMessage) => {
    try {
      const sent = await messagesApi.send(token, id, {
        ...(message.text ? { text: message.text } : {}),
        clientMessageId: message.clientMessageId,
        ...(message.attachmentIds?.length
          ? { attachmentIds: message.attachmentIds }
          : {}),
        ...(message.replyToMessageId
          ? { replyToMessageId: message.replyToMessageId }
          : {}),
      });
      setItems((current) => mergeMessages(current, [sent]));
      dispatch({ type: "removed", clientMessageId: message.clientMessageId });
      onChanged();
    } catch {
      dispatch({ type: "failed", clientMessageId: message.clientMessageId });
    }
  };

  const send = () => {
    if (!canSend(draft, uploads)) return;
    const attachmentIds = readyAttachmentIds(uploads);
    const message: OutgoingMessage = {
      clientMessageId: newClientMessageId(),
      conversationId: id,
      text: draft.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
    };
    dispatch({ type: "queued", message });
    setDraft("");
    setReplyTo(null);
    dispatchUpload({ type: "cleared" });
    uploadJobs.current.clear();
    stickToBottom.current = true;
    void deliver(message);
  };

  const retry = (message: OutgoingMessage) => {
    dispatch({ type: "retried", clientMessageId: message.clientMessageId });
    void deliver(message);
  };

  // --- feltöltés, fájlonként
  const startUpload = (localId: string, file: File) => {
    const abort = new AbortController();
    uploadJobs.current.set(localId, { file, abort });
    void uploadMessageAttachment(
      token,
      id,
      file,
      (percent) => dispatchUpload({ type: "progress", localId, percent }),
      abort.signal,
    )
      .then((attachment) =>
        dispatchUpload({ type: "done", localId, attachmentId: attachment.id }),
      )
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        dispatchUpload({
          type: "failed",
          localId,
          error:
            cause instanceof Error
              ? cause.message
              : "A feltöltés nem sikerült.",
        });
      });
  };

  const addFiles = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const localId = newClientMessageId();
      dispatchUpload({
        type: "added",
        upload: { localId, fileName: file.name, sizeBytes: file.size },
      });
      if (file.size > UPLOAD_MAX_BYTES) {
        dispatchUpload({
          type: "failed",
          localId,
          error: "A fájl nagyobb 10 MB-nál.",
        });
        continue;
      }
      startUpload(localId, file);
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const retryUpload = (localId: string) => {
    const job = uploadJobs.current.get(localId);
    if (!job) return;
    dispatchUpload({ type: "retried", localId });
    startUpload(localId, job.file);
  };

  const cancelUpload = (localId: string) => {
    uploadJobs.current.get(localId)?.abort.abort();
    uploadJobs.current.delete(localId);
    dispatchUpload({ type: "removed", localId });
  };

  // --- műveletek egy üzeneten
  const react = async (message: MessageItem, reaction: string) => {
    const mine = message.reactions.some(
      (r) => r.reaction === reaction && r.mine,
    );
    try {
      const fresh = mine
        ? await messagesApi.unreact(token, message.id, reaction)
        : await messagesApi.react(token, message.id, reaction);
      setItems((current) => mergeMessages(current, [fresh]));
    } catch {
      setNotice("A reakció nem mentődött el.");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const fresh = await messagesApi.edit(token, editing.id, editing.text);
      setItems((current) => mergeMessages(current, [fresh]));
      setEditing(null);
    } catch {
      setNotice("A szerkesztés nem mentődött el.");
    }
  };

  const remove = async (message: MessageItem) => {
    setDeleting(null);
    try {
      await messagesApi.remove(token, message.id);
      await refreshOne(message.id);
      onChanged();
    } catch {
      setNotice("Az üzenet nem törlődött.");
    }
  };

  const copy = (message: MessageItem) => {
    if (message.text) void navigator.clipboard?.writeText(message.text);
  };

  const togglePin = async (message: MessageItem) => {
    try {
      const fresh = message.pinned
        ? await messagesApi.unpin(token, message.id)
        : await messagesApi.pin(token, message.id);
      setItems((current) => mergeMessages(current, [fresh]));
      setPinsVersion((version) => version + 1);
    } catch {
      setNotice("A kitűzés nem mentődött el.");
    }
  };

  const forwardTo = async (target: ConversationListItem) => {
    if (!forwarding) return;
    await messagesApi.forward(token, forwarding.message.id, {
      conversationId: target.id,
      clientMessageId: forwarding.clientMessageId,
    });
    setForwarding(null);
    setNotice(`Továbbítva: ${conversationName(target)}`);
    onChanged();
  };

  const now = new Date();
  const pending = visibleOutgoing(outbox, id, items);
  const name = conversationName(conversation);

  return (
    <div className="flex min-h-0 flex-1">
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
                {context ? ` · ${contextSubtitle(context.type)}` : null}
              </p>
            ) : null}
          </div>
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              aria-label="Keresés és kitűzött elemek"
              aria-pressed={drawer === "search"}
              className="flex size-9 items-center justify-center text-pilot-grey-600 hover:text-pilot-grey-900"
              onClick={() =>
                setDrawer((current) => (current === "search" ? null : "search"))
              }
            >
              <Icon name="search" size={18} />
            </button>
            <button
              type="button"
              aria-label="Beszélgetés adatai"
              aria-pressed={drawer === "details"}
              className="flex size-9 items-center justify-center text-pilot-grey-600 hover:text-pilot-grey-900"
              onClick={() =>
                setDrawer((current) =>
                  current === "details" ? null : "details",
                )
              }
            >
              <Icon name="info" size={18} />
            </button>
          </div>
        </header>

        {context ? <ContextCard card={context} /> : null}

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
          {notice ? (
            <p role="status" className="text-center text-sm text-pilot-red-700">
              {notice}
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
            // a rendszer-esemény (csatolás, tag, kilépés): középen, buborék és menü nélkül
            if (isSystemMessage(message))
              return (
                <div key={message.id} data-testid={`message-${message.id}`}>
                  {showDivider ? (
                    <p className="py-2 text-center text-xs text-pilot-grey-500">
                      {divider}
                    </p>
                  ) : null}
                  <p
                    data-testid="system-message"
                    className="px-6 text-center text-xs text-pilot-grey-500"
                  >
                    {message.text}
                  </p>
                </div>
              );
            return (
              <div
                key={message.id}
                data-testid={`message-${message.id}`}
                data-highlighted={highlight === message.id ? "true" : undefined}
                className={
                  highlight === message.id
                    ? "bg-pilot-accent-warm-soft transition-colors"
                    : "transition-colors"
                }
              >
                {showDivider ? (
                  <p className="py-2 text-center text-xs text-pilot-grey-500">
                    {divider}
                  </p>
                ) : null}
                <div
                  className={`group flex flex-col gap-1 ${own ? "items-end" : "items-start"}`}
                >
                  {editing?.id === message.id ? (
                    <div className="flex w-full max-w-[70%] flex-col gap-2">
                      <Textarea
                        aria-label="Az üzenet új szövege"
                        value={editing.text}
                        maxLength={4000}
                        onChange={(event) =>
                          setEditing({
                            id: message.id,
                            text: event.target.value,
                          })
                        }
                      />
                      <div className="flex justify-end gap-3 text-xs">
                        <button type="button" onClick={() => setEditing(null)}>
                          Mégse
                        </button>
                        <button
                          type="button"
                          className="font-medium text-pilot-aqua-700"
                          onClick={() => void saveEdit()}
                        >
                          Mentés
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Bubble
                      message={message}
                      own={own}
                      sender={
                        conversation.type === "GROUP" && !own
                          ? message.senderName
                          : null
                      }
                      onReact={(reaction) => void react(message, reaction)}
                    />
                  )}
                  {!message.deleted && editing?.id !== message.id ? (
                    <div
                      role="toolbar"
                      aria-label="Műveletek az üzeneten"
                      className="flex flex-wrap gap-1 text-xs opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                    >
                      {MESSAGE_REACTIONS.map((reaction) => (
                        <button
                          key={reaction}
                          type="button"
                          aria-label={`Reakció: ${reaction}`}
                          className="border border-pilot-grey-200 bg-white px-2 py-0.5"
                          onClick={() => void react(message, reaction)}
                        >
                          {reaction}
                        </button>
                      ))}
                      {messageActions({
                        own,
                        deleted: message.deleted,
                        pinned: message.pinned === true,
                        hasText: !!message.text,
                      }).map((action) => (
                        <button
                          key={action}
                          type="button"
                          className={`px-2 py-0.5 ${
                            action === "delete"
                              ? "text-pilot-red-700"
                              : "text-pilot-grey-600 hover:text-pilot-grey-900"
                          }`}
                          onClick={() => {
                            if (action === "reply") setReplyTo(message);
                            else if (action === "copy") copy(message);
                            else if (action === "forward")
                              setForwarding({
                                message,
                                clientMessageId: newClientMessageId(),
                              });
                            else if (action === "pin" || action === "unpin")
                              void togglePin(message);
                            else if (action === "edit")
                              setEditing({
                                id: message.id,
                                text: message.text ?? "",
                              });
                            else setDeleting(message);
                          }}
                        >
                          {ACTION_LABELS[action]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {pending.map((message) => (
            <div key={message.clientMessageId}>
              <PendingBubble message={message} />
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

        <div className="border-t border-pilot-grey-200 px-5 py-4">
          {replyTo ? (
            <div
              data-testid="reply-preview"
              className="mb-3 flex items-start justify-between gap-3 bg-pilot-accent-warm-soft px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-medium text-pilot-accent-warm-text">
                  Válasz neki: {replyTo.senderName}
                </p>
                <p className="truncate text-pilot-grey-700">
                  {previewText(replyTo)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Válasz megszakítása"
                onClick={() => setReplyTo(null)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ) : null}
          {uploads.length ? (
            <ul className="mb-3 flex flex-wrap gap-2" aria-label="Csatolmányok">
              {uploads.map((upload) => (
                <li
                  key={upload.localId}
                  className="flex items-center gap-2 border border-pilot-grey-200 px-2 py-1 text-xs"
                  data-status={upload.status}
                >
                  <span className="max-w-40 truncate">{upload.fileName}</span>
                  <span className="text-pilot-grey-500">
                    {upload.status === "uploading"
                      ? `${upload.percent}%`
                      : upload.status === "done"
                        ? fileSizeLabel(upload.sizeBytes)
                        : (upload.error ?? "Hiba")}
                  </span>
                  {upload.status === "failed" &&
                  uploadJobs.current.has(upload.localId) ? (
                    <button
                      type="button"
                      aria-label={`Újra: ${upload.fileName}`}
                      className="font-medium text-pilot-aqua-700"
                      onClick={() => retryUpload(upload.localId)}
                    >
                      Újra
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Eltávolítás: ${upload.fileName}`}
                    onClick={() => cancelUpload(upload.localId)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="flex items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="hidden"
              data-testid="attachment-input"
              onChange={(event) => addFiles(event.target.files)}
            />
            <button
              type="button"
              aria-label="Csatolmány hozzáadása"
              className="flex size-11 shrink-0 items-center justify-center border border-pilot-grey-200 text-pilot-grey-600"
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="file-text" size={18} />
            </button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Üzenet</span>
              <Textarea
                value={draft}
                rows={1}
                maxLength={4000}
                placeholder={replyTo ? "Írj választ…" : "Írj egy üzenetet…"}
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
              disabled={!canSend(draft, uploads)}
              className="flex size-11 shrink-0 items-center justify-center bg-pilot-aqua-700 text-white disabled:opacity-40"
            >
              <Icon name="send" size={18} />
            </button>
          </form>
        </div>
        <ConfirmDialog
          open={deleting !== null}
          title="Törlöd az üzenetet?"
          consequence="Az üzenet helyén mindenkinél az „Az üzenetet törölték.” felirat marad, a szövege és a csatolmányai nem látszanak többé."
          recovery="A törlés nem vonható vissza: ha mégis kell, újra el kell küldeni."
          confirmLabel="Törlés"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            if (deleting) void remove(deleting);
          }}
        />
      </section>
      {drawer === "search" ? (
        <SearchAndPinsPanel
          token={token}
          conversationId={id}
          pinsVersion={pinsVersion}
          onJump={(messageId) => void jumpTo(messageId)}
          onClose={() => setDrawer(null)}
        />
      ) : null}
      {drawer === "details" ? (
        <ConversationDetailsPanel
          token={token}
          conversation={conversation}
          context={context}
          onClose={() => setDrawer(null)}
          onChanged={() => {
            setContextVersion((version) => version + 1);
            onChanged();
          }}
          onLeft={() => {
            setDrawer(null);
            onLeft?.();
          }}
        />
      ) : null}
      {forwarding ? (
        <ForwardDialog
          token={token}
          currentConversationId={id}
          onClose={() => setForwarding(null)}
          onForward={forwardTo}
        />
      ) : null}
    </div>
  );
}

function Time({
  value,
  edited,
  pending,
  pinned,
}: {
  value: string;
  edited?: boolean;
  pending?: boolean;
  pinned?: boolean;
}) {
  return (
    <p className="mt-1 text-xs text-pilot-grey-500">
      {new Date(value).toLocaleTimeString("hu-HU", {
        hour: "2-digit",
        minute: "2-digit",
      })}
      {edited ? " · szerkesztve" : ""}
      {pending ? " · küldés…" : ""}
      {pinned ? " · 📌 kitűzve" : ""}
    </p>
  );
}

function Bubble({
  message,
  own,
  sender,
  onReact,
}: {
  message: MessageItem;
  own: boolean;
  sender: string | null;
  onReact: (reaction: string) => void;
}) {
  return (
    <div
      className={`max-w-[70%] px-4 py-3 text-sm ${
        own
          ? "bg-pilot-aqua-50 text-pilot-grey-900"
          : "bg-pilot-grey-100 text-pilot-grey-900"
      }`}
      data-status="sent"
    >
      {sender ? (
        <p className="mb-1 text-xs font-medium text-pilot-aqua-700">{sender}</p>
      ) : null}
      {message.forwardedFrom && !message.deleted ? (
        <p
          data-testid="forwarded-from"
          className="mb-1 text-xs italic text-pilot-grey-500"
        >
          Továbbítva · {message.forwardedFrom.senderName}
        </p>
      ) : null}
      {message.replyTo ? (
        <div
          data-testid="reply-quote"
          className="mb-2 border-l-2 border-pilot-aqua-700 pl-2 text-xs text-pilot-grey-600"
        >
          <p className="font-medium">{message.replyTo.senderName}</p>
          <p className="truncate">
            {message.replyTo.deleted
              ? "Az üzenetet törölték."
              : (message.replyTo.text ??
                (message.replyTo.attachmentKind === "IMAGE"
                  ? "📷 Kép"
                  : "📎 Fájl"))}
          </p>
        </div>
      ) : null}
      {message.deleted ? (
        <p className="italic text-pilot-grey-500">Az üzenetet törölték.</p>
      ) : (
        <>
          {message.attachments.map((attachment) =>
            attachment.hasThumbnail ? (
              <a
                key={attachment.id}
                href={attachmentUrl(attachment.id)}
                className="mb-2 block"
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={attachmentUrl(attachment.id, "thumbnail")}
                  alt={attachment.fileName}
                  className="max-h-60 max-w-full"
                />
                <span className="mt-1 block text-xs text-pilot-grey-500">
                  {attachment.fileName} · {fileSizeLabel(attachment.sizeBytes)}
                </span>
              </a>
            ) : (
              <a
                key={attachment.id}
                href={attachmentUrl(attachment.id)}
                className="mb-2 flex items-center gap-2 text-xs underline"
              >
                <span aria-hidden="true">📎</span>
                {attachment.fileName} · {fileSizeLabel(attachment.sizeBytes)}
              </a>
            ),
          )}
          {message.text ? (
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          ) : null}
        </>
      )}
      <Time
        value={message.createdAt}
        edited={message.editedAt !== null}
        pinned={message.pinned === true}
      />
      {message.reactions.length ? (
        <div className="mt-1 flex gap-1" aria-label="Reakciók">
          {message.reactions.map((r) => (
            <button
              key={r.reaction}
              type="button"
              aria-pressed={r.mine}
              aria-label={`${r.reaction} ${r.count}`}
              className={`border px-1.5 text-xs ${
                r.mine
                  ? "border-pilot-aqua-700 bg-white"
                  : "border-pilot-grey-200 bg-white"
              }`}
              onClick={() => onReact(r.reaction)}
            >
              {r.reaction} {r.count}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PendingBubble({ message }: { message: OutgoingMessage }) {
  const count = message.attachmentIds?.length ?? 0;
  return (
    <div className="flex justify-end">
      <div
        className={`max-w-[70%] bg-pilot-aqua-50 px-4 py-3 text-sm text-pilot-grey-900 ${
          message.status === "failed" ? "border border-pilot-red-700" : ""
        }`}
        data-status={message.status}
      >
        {message.text ? (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        ) : null}
        {count ? <p className="text-xs">📎 {count} csatolmány</p> : null}
        <Time
          value={message.createdAt}
          pending={message.status === "pending"}
        />
      </div>
    </div>
  );
}

/**
 * A KAPCSOLT MUNKALAP VAGY HIBAJEGY (Figma 450:323): „KAPCSOLT MUNKALAP ·
 * BIO-2026-001 · partner · állapot · dátum · Megnyitás”. Aki a szervizt nem
 * látja, annak csak a szám, „Megnyitás” nélkül.
 */
function ContextCard({ card }: { card: ConversationContextCard }) {
  const href = contextHref(card);
  return (
    <div
      data-testid="context-card"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-pilot-grey-200 bg-pilot-grey-50 px-5 py-3 text-xs"
    >
      <span className="font-semibold tracking-wide text-pilot-accent-warm-text">
        {contextCardTitle(card.type)}
      </span>
      {contextCardParts(card).map((part) => (
        <span key={part} className="text-pilot-grey-700">
          · {part}
        </span>
      ))}
      {href ? (
        <Link
          href={href}
          className="ml-auto font-medium text-pilot-aqua-700 hover:underline"
        >
          Megnyitás
        </Link>
      ) : null}
    </div>
  );
}
