import { apiRequest } from "./client";
import { uploadWithProgress, type UploadHandle } from "./upload-with-progress";
import type {
  ConversationDetail,
  MessageAttachmentItem,
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
  /** Üres csak csatolmánnyal lehet; a szerver dönt. */
  text?: string;
  /** Az újraküldés ezzel nem duplikál. */
  clientMessageId: string;
  /** A saját, még el nem küldött feltöltések (2. fázis). */
  attachmentIds?: string[];
  /** A megválaszolt üzenet, ugyanebből a beszélgetésből. */
  replyToMessageId?: string;
}

/** A saját üzenet szerkesztése; a szerver `EditMessageDto`-jával azonos. */
export interface EditMessageInput {
  text: string;
}

/** Reakció; a szerver `ReactionDto`-jával azonos. */
export interface ReactionInput {
  reaction: string;
}

/** A feltöltendő fájl a készülékről: a natív réteg az `uri`-ból olvas. */
export interface AttachmentUploadFile {
  uri: string;
  name: string;
  type: string;
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

export function getMessage(id: string) {
  return apiRequest<MessageItem>(`${MESSAGES}/${encodeURIComponent(id)}`);
}

export function editMessage(id: string, input: EditMessageInput) {
  return apiRequest<MessageItem>(`${MESSAGES}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteMessage(id: string) {
  return apiRequest<{ deleted: boolean }>(
    `${MESSAGES}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function addReaction(id: string, input: ReactionInput) {
  return apiRequest<MessageItem>(
    `${MESSAGES}/${encodeURIComponent(id)}/reactions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function removeReaction(id: string, reaction: string) {
  return apiRequest<MessageItem>(
    `${MESSAGES}/${encodeURIComponent(id)}/reactions/${encodeURIComponent(reaction)}`,
    { method: "DELETE" },
  );
}

/** Egy fájl feltöltése a beszélgetésbe, üzenet nélkül; a küldés köti az üzenethez. */
export function uploadMessageAttachment(
  conversationId: string,
  file: AttachmentUploadFile,
  onProgress: (percent: number) => void,
): UploadHandle<MessageAttachmentItem> {
  const form = new FormData();
  form.append("file", file as unknown as Blob);
  return uploadWithProgress<MessageAttachmentItem>(
    `${MESSAGES}/conversations/${encodeURIComponent(conversationId)}/attachments`,
    form,
    onProgress,
  );
}
