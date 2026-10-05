import type {
  MessageAttachmentItem,
  ConversationDetail,
  ConversationListResponse,
  MessageItem,
  MessagePage,
  MessagePeopleResponse,
  MessagesUnreadResponse,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { ApiError, apiAuthHeaders, apiRequest } from "./client";

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
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `${API_PREFIX}/messages/conversations/${encodeURIComponent(conversationId)}/attachments`,
    );
    request.setRequestHeader("Accept", "application/json");
    for (const [name, value] of Object.entries(apiAuthHeaders(token, "POST")))
      request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("error", () =>
      reject(new ApiError("A feltöltés nem sikerült: nincs kapcsolat.", 0)),
    );
    request.addEventListener("abort", () =>
      reject(new ApiError("A feltöltést megszakítottad.", 0)),
    );
    request.addEventListener("load", () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300) {
        // egy azonosító nélküli „kész” feltöltés a küldésnél nem létező csatolmányra mutatna
        if (!payload || typeof payload !== "object") {
          reject(
            new ApiError("A szerver válasza nem olvasható.", request.status),
          );
          return;
        }
        onProgress(100);
        resolve(payload as MessageAttachmentItem);
        return;
      }
      const message =
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message
          : "A feltöltés nem sikerült.";
      reject(new ApiError(message, request.status));
    });
    signal?.addEventListener("abort", () => request.abort());
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}
