import type {
  MessageAttachmentItem,
  ConversationDetail,
  ConversationListResponse,
  ConversationNotificationState,
  ConversationNotifyMode,
  MessageItem,
  MessagePage,
  MessagePeopleResponse,
  MessageSearchResponse,
  MessagesUnreadResponse,
  PinnedItemsResponse,
  SharedAttachmentPage,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { apiRequest } from "./client";
import { uploadWithProgress } from "./upload-with-progress";

function conversationPath(id: string) {
  return `/messages/conversations/${encodeURIComponent(id)}`;
}

/** Az Üzenetek modul (kártya 51d7aba0) hívásai. A jogot a tagság adja, a szerver dönt. */
export const messagesApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<ConversationListResponse>(
      "/messages/conversations",
      token,
      {
        signal,
      },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ConversationDetail>(conversationPath(id), token, {
      signal,
    });
  },
  page(token: string, id: string, before?: string, signal?: AbortSignal) {
    // üres `before`: az első (legújabb) oldal
    return apiRequest<MessagePage>(
      `${conversationPath(id)}/messages?before=${encodeURIComponent(before ?? "")}`,
      token,
      {
        signal,
      },
    );
  },
  /** 3. fázis, „Ugrás”: az üzenet köré nyíló oldal. */
  around(token: string, id: string, messageId: string, signal?: AbortSignal) {
    return apiRequest<MessagePage>(
      `${conversationPath(id)}/messages?around=${encodeURIComponent(messageId)}`,
      token,
      { signal },
    );
  },
  /** 3. fázis: az ugrás utáni újabb oldal. */
  newer(token: string, id: string, after: string, signal?: AbortSignal) {
    return apiRequest<MessagePage>(
      `${conversationPath(id)}/messages?after=${encodeURIComponent(after)}`,
      token,
      { signal },
    );
  },
  /** 3. fázis: keresés a megnyitott beszélgetésben. */
  search(token: string, id: string, q: string, signal?: AbortSignal) {
    return apiRequest<MessageSearchResponse>(
      `${conversationPath(id)}/search?q=${encodeURIComponent(q)}`,
      token,
      { signal },
    );
  },
  /** 3. fázis: a megosztott média vagy fájlok, a legújabb elöl. */
  shared(
    token: string,
    id: string,
    kind: "IMAGE" | "FILE",
    signal?: AbortSignal,
  ) {
    return apiRequest<SharedAttachmentPage>(
      `${conversationPath(id)}/attachments?kind=${kind}`,
      token,
      { signal },
    );
  },
  /** 3. fázis: a kitűzött elemek. */
  pins(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<PinnedItemsResponse>(
      `${conversationPath(id)}/pins`,
      token,
      {
        signal,
      },
    );
  },
  pin(token: string, messageId: string) {
    return apiRequest<MessageItem>(
      `/messages/${encodeURIComponent(messageId)}/pin`,
      token,
      { method: "POST" },
    );
  },
  unpin(token: string, messageId: string) {
    return apiRequest<MessageItem>(
      `/messages/${encodeURIComponent(messageId)}/pin`,
      token,
      { method: "DELETE" },
    );
  },
  forward(
    token: string,
    messageId: string,
    input: { conversationId: string; clientMessageId: string },
  ) {
    return apiRequest<MessageItem>(
      `/messages/${encodeURIComponent(messageId)}/forward`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  /** 3. fázis: a saját értesítési beállítás ebben a beszélgetésben. */
  setNotification(token: string, id: string, mode: ConversationNotifyMode) {
    return apiRequest<ConversationNotificationState>(
      `${conversationPath(id)}/notifications`,
      token,
      { method: "PUT", body: JSON.stringify({ mode }) },
    );
  },
  send(
    token: string,
    id: string,
    input: {
      text?: string;
      clientMessageId: string;
      attachmentIds?: string[];
      replyToMessageId?: string;
    },
  ) {
    return apiRequest<MessageItem>(`${conversationPath(id)}/messages`, token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  message(token: string, messageId: string, signal?: AbortSignal) {
    return apiRequest<MessageItem>(
      `/messages/${encodeURIComponent(messageId)}`,
      token,
      { signal },
    );
  },
  edit(token: string, messageId: string, text: string) {
    return apiRequest<MessageItem>(
      `/messages/${encodeURIComponent(messageId)}`,
      token,
      { method: "PATCH", body: JSON.stringify({ text }) },
    );
  },
  remove(token: string, messageId: string) {
    return apiRequest<{ deleted: true }>(
      `/messages/${encodeURIComponent(messageId)}`,
      token,
      { method: "DELETE" },
    );
  },
  react(token: string, messageId: string, reaction: string) {
    return apiRequest<MessageItem>(
      `/messages/${encodeURIComponent(messageId)}/reactions`,
      token,
      { method: "POST", body: JSON.stringify({ reaction }) },
    );
  },
  unreact(token: string, messageId: string, reaction: string) {
    return apiRequest<MessageItem>(
      `/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reaction)}`,
      token,
      { method: "DELETE" },
    );
  },
  markRead(token: string, id: string, messageId: string) {
    return apiRequest<{ moved: boolean }>(
      `${conversationPath(id)}/read`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ messageId }),
      },
    );
  },
  create(token: string, input: { memberIds: string[]; title?: string }) {
    return apiRequest<ConversationDetail>("/messages/conversations", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  people(token: string, q: string, signal?: AbortSignal) {
    return apiRequest<MessagePeopleResponse>(
      `/messages/people?q=${encodeURIComponent(q)}`,
      token,
      { signal },
    );
  },
  unread(token: string, signal?: AbortSignal) {
    return apiRequest<MessagesUnreadResponse>("/messages/unread", token, {
      signal,
    });
  },
};

/**
 * A FOLYAM CÍME. Ugyanarról az originről, a Next rewrite-on át: a böngésző a
 * munkamenet-sütit magától viszi, fejlécet az `EventSource` nem tud küldeni.
 */
export const MESSAGE_STREAM_URL = `${API_PREFIX}/messages/stream`;

/** Egy csatolmány címe a böngészőnek (kép `src`, letöltés `href`); a munkamenet-süti hitelesít. */
export function attachmentUrl(id: string, variant?: "thumbnail") {
  return `${API_PREFIX}/messages/attachments/${encodeURIComponent(id)}${
    variant ? `?variant=${variant}` : ""
  }`;
}

/**
 * EGY FÁJL FELTÖLTÉSE, haladással és megszakíthatóan (a terv 2.2 pontja): a
 * `fetch` nem ad feltöltési százalékot, ezért `XMLHttpRequest`, ugyanúgy, mint a
 * leltár- és a UNAS-import. A `signal` megszakítja a kérést (Mégse).
 */
export function uploadMessageAttachment(
  token: string,
  conversationId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<MessageAttachmentItem> {
  const form = new FormData();
  form.append("file", file);
  return uploadWithProgress<MessageAttachmentItem>(
    `${API_PREFIX}/messages/conversations/${encodeURIComponent(conversationId)}/attachments`,
    token,
    form,
    {
      onProgress,
      signal,
      networkError: "A feltöltés nem sikerült: nincs kapcsolat.",
      failure: "A feltöltés nem sikerült.",
      aborted: "A feltöltést megszakítottad.",
    },
  );
}
