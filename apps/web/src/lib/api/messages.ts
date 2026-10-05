import type {
  ConversationDetail,
  ConversationListResponse,
  MessageItem,
  MessagePage,
  MessagePeopleResponse,
  MessagesUnreadResponse,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { apiRequest } from "./client";

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
  send(token: string, id: string, text: string, clientMessageId: string) {
    return apiRequest<MessageItem>(`${conversationPath(id)}/messages`, token, {
      method: "POST",
      body: JSON.stringify({ text, clientMessageId }),
    });
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
