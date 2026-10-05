import { apiRequest } from "./client";
import type {
  ConversationDetail,
  ConversationListResponse,
  MessageItem,
  MessagePage,
  MessagePeopleResponse,
  MessagesUnreadResponse,
} from "@/lib/messages/types";

/** Az Üzenetek modul (kártya 51d7aba0) hívásai. A jogot a tagság adja, a szerver dönt. */
const MESSAGES = "/messages";

/** Az üzenet küldése; a szerver `SendMessageDto`-jával azonos. */
export interface SendMessageInput {
  text: string;
  /** Az újraküldés ezzel nem duplikál. */
  clientMessageId: string;
}

/** Új beszélgetés; a szerver `CreateConversationDto`-jával azonos. */
export interface CreateConversationInput {
  memberIds: string[];
  title?: string;
}

/** Olvasottnak jelölés; a szerver `MarkReadDto`-jával azonos. */
export interface MarkReadInput {
  messageId: string;
}

export function listConversations() {
  return apiRequest<ConversationListResponse>(`${MESSAGES}/conversations`);
}

export function getConversation(id: string) {
  return apiRequest<ConversationDetail>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}`,
  );
}

/** Üres `before`: az első (legújabb) oldal. */
export function getMessagePage(id: string, before?: string) {
  return apiRequest<MessagePage>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/messages?before=${encodeURIComponent(before ?? "")}`,
  );
}

export function sendMessage(id: string, input: SendMessageInput) {
  return apiRequest<MessageItem>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function markConversationRead(id: string, input: MarkReadInput) {
  return apiRequest<{ moved: boolean }>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/read`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createConversation(input: CreateConversationInput) {
  return apiRequest<ConversationDetail>(`${MESSAGES}/conversations`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function searchMessagePeople(q: string) {
  return apiRequest<MessagePeopleResponse>(
    `${MESSAGES}/people?q=${encodeURIComponent(q)}`,
  );
}

export function getMessagesUnread() {
  return apiRequest<MessagesUnreadResponse>(`${MESSAGES}/unread`);
}
