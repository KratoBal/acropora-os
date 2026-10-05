import { apiRequest } from "./client";
import { uploadWithProgress, type UploadHandle } from "./upload-with-progress";
import type {
  ConversationContextType,
  ConversationDetail,
  MessageAttachmentItem,
  ConversationListResponse,
  MessageItem,
  MessagePage,
  MessagePeopleResponse,
  MessageSearchResponse,
  MessagesUnreadResponse,
  ConversationNotificationState,
  ConversationNotifyMode,
  PinnedItemsResponse,
  SharedAttachmentPage,
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

/** Továbbítás; a szerver `ForwardMessageDto`-jával azonos (3. fázis). */
export interface ForwardMessageInput {
  conversationId: string;
  /** Egy újrapróbálás ezzel nem továbbít kétszer. */
  clientMessageId: string;
}

/** Az értesítési beállítás; a szerver `NotificationSettingDto`-jával azonos (3. fázis). */
export interface NotificationSettingInput {
  mode: ConversationNotifyMode;
}

/** 3. fázis, „Ugrás”: az üzenet köré nyíló oldal. */
export function getMessagesAround(id: string, messageId: string) {
  return apiRequest<MessagePage>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/messages?around=${encodeURIComponent(messageId)}`,
  );
}

/** 3. fázis: az ugrás utáni újabb oldal. */
export function getMessagesAfter(id: string, after: string) {
  return apiRequest<MessagePage>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/messages?after=${encodeURIComponent(after)}`,
  );
}

/** 3. fázis: keresés a megnyitott beszélgetésben. */
export function searchConversation(id: string, q: string) {
  return apiRequest<MessageSearchResponse>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`,
  );
}

/** 3. fázis: a megosztott média vagy fájlok. */
export function getSharedAttachments(id: string, kind: "IMAGE" | "FILE") {
  return apiRequest<SharedAttachmentPage>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/attachments?kind=${kind}`,
  );
}

/** 3. fázis: a kitűzött elemek. */
export function getPins(id: string) {
  return apiRequest<PinnedItemsResponse>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/pins`,
  );
}

export function pinMessage(id: string) {
  return apiRequest<MessageItem>(`${MESSAGES}/${encodeURIComponent(id)}/pin`, {
    method: "POST",
  });
}

export function unpinMessage(id: string) {
  return apiRequest<MessageItem>(`${MESSAGES}/${encodeURIComponent(id)}/pin`, {
    method: "DELETE",
  });
}

export function forwardMessage(id: string, input: ForwardMessageInput) {
  return apiRequest<MessageItem>(
    `${MESSAGES}/${encodeURIComponent(id)}/forward`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function setConversationNotification(
  id: string,
  input: NotificationSettingInput,
) {
  return apiRequest<ConversationNotificationState>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/notifications`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

/** 4. fázis: egy csoport csatolása munkalaphoz vagy hibajegyhez (a `LinkContextDto` párja). */
export interface LinkContextInput {
  type: ConversationContextType;
  id: string;
}

/** 4. fázis: tagok felvétele egy csoportba (az `AddMembersDto` párja). */
export interface AddMembersInput {
  userIds: string[];
}

/**
 * 4. fázis, „Beszélgetés” a munkalapról vagy a hibajegyről: a tárgy élő
 * beszélgetése, vagy egy új; a kérdezőt a szerver felveszi.
 */
export function openContextConversation(
  kind: "worksheet" | "service-job",
  objectId: string,
) {
  return apiRequest<ConversationDetail>(
    `${MESSAGES}/context/${kind}/${encodeURIComponent(objectId)}`,
    { method: "POST" },
  );
}

export function linkConversationContext(id: string, input: LinkContextInput) {
  return apiRequest<ConversationDetail>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/context`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function unlinkConversationContext(id: string) {
  return apiRequest<ConversationDetail>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/context`,
    { method: "DELETE" },
  );
}

export function addConversationMembers(id: string, input: AddMembersInput) {
  return apiRequest<ConversationDetail>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/members`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function leaveConversation(id: string) {
  return apiRequest<{ left: true; archived: boolean }>(
    `${MESSAGES}/conversations/${encodeURIComponent(id)}/leave`,
    { method: "POST" },
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
