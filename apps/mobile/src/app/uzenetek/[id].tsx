import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import type * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DocumentImage } from "@/components/documents/DocumentImage";
import {
  AttachPanel,
  MessageActionsPanel,
  MessageBubble,
  PendingBubble,
  UploadChips,
} from "@/components/messages/MessageBubble";
import { conversationName } from "@/components/messages/MessageParts";
import { useMessageStream } from "@/components/messages/MessageStream";
import { ApiError, ApiNetworkError } from "@/lib/api/client";
import {
  addReaction,
  deleteMessage,
  editMessage,
  getConversation,
  getMessage,
  getMessagePage,
  markConversationRead,
  removeReaction,
  sendMessage,
  uploadMessageAttachment,
  type AttachmentUploadFile,
} from "@/lib/api/messages";
import { toPickedImages } from "@/lib/api/picked-image";
import {
  UploadAbortedError,
  type UploadHandle,
} from "@/lib/api/upload-with-progress";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  canSend,
  dayDividerLabel,
  mergeMessages,
  newClientMessageId,
  outboxReducer,
  previewText,
  readyAttachmentIds,
  uploadsReducer,
  visibleOutgoing,
  type OutgoingMessage,
} from "@/lib/messages/outbox";
import {
  MESSAGE_ATTACHMENTS_MAX,
  type ConversationDetail,
  type MessageAttachmentItem,
  type MessageItem,
  type MessageReactionValue,
} from "@/lib/messages/types";
import {
  pickPhotosFromLibrary,
  takePhotoFromCamera,
  type PhotoPickResult,
} from "@/lib/photos/pick-photos";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

type Row =
  | { kind: "message"; key: string; message: MessageItem }
  | { kind: "pending"; key: string; message: OutgoingMessage }
  | { kind: "divider"; key: string; label: string };

/** Egy feltöltés hibájának mondata a sorban. */
function uploadErrorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof ApiNetworkError) return "Nincs kapcsolat.";
  return "A feltöltés nem sikerült.";
}

/**
 * EGY BESZÉLGETÉS (Figma 443:307; a 2. fázis: 454:371 és 454:457). Fordított
 * lista: a legújabb lent, a régebbi oldal a lista végére érve töltődik. Egy
 * üzenet addig "küldés…", amíg a szerver vissza nem igazolta; hibánál Újra
 * (ugyanazzal az azonosítóval) és Törlés.
 *
 * A 2. fázis: hosszú nyomásra reakció, válasz, és a saját üzeneten szerkesztés
 * és törlés; csatolásnál fotó a kamerából vagy a galériából, fájlonként
 * haladással. A szerkesztés, a törlés és a reakció eredménye a `sent` listába
 * kerül, mert az felülírja a lapok régebbi példányát (`mergeMessages`).
 */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const enabled = status === "authenticated" && Boolean(id);
  const detail = useQuery({
    queryKey: ["messages", "detail", id],
    queryFn: () => getConversation(id!),
    enabled,
  });
  const latestPage = useQuery({
    queryKey: ["messages", "page", id],
    queryFn: () => getMessagePage(id!),
    enabled,
  });
  // a régebbi oldalak és a saját, már megerősített üzenetek: eseménykezelő tölti
  const [older, setOlder] = useState<MessageItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [sent, setSent] = useState<MessageItem[]>([]);
  const [draft, setDraft] = useState("");
  const [outbox, dispatch] = useReducer(outboxReducer, []);
  const [uploads, dispatchUpload] = useReducer(uploadsReducer, []);
  // a feltöltés újrapróbálásához és megszakításához kell a fájl és a futó kérés
  const uploadJobs = useRef(
    new Map<
      string,
      { file: AttachmentUploadFile; handle: UploadHandle<unknown> | null }
    >(),
  );
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [editing, setEditing] = useState<MessageItem | null>(null);
  const [actionsFor, setActionsFor] = useState<MessageItem | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [bigImage, setBigImage] = useState<MessageAttachmentItem | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const lastMarked = useRef<string | null>(null);

  const conversation: ConversationDetail | null = detail.data ?? null;
  const items = useMemo(
    () =>
      mergeMessages(mergeMessages(older, latestPage.data?.items ?? []), sent),
    [older, latestPage.data, sent],
  );
  const cursor =
    olderCursor === undefined
      ? (latestPage.data?.olderCursor ?? null)
      : olderCursor;
  const error = latestPage.error ?? detail.error;
  const notice = !error
    ? null
    : error instanceof ApiNetworkError
      ? "Offline mód: az üzenetek nem frissültek."
      : error instanceof ApiError && error.status === 404
        ? "A beszélgetés nem található."
        : "Az üzenetek nem töltődtek be.";

  // a szerver friss példánya felülírja a lapokon állót
  const refreshOne = async (messageId: string) => {
    const fresh = await getMessage(messageId);
    setSent((current) => mergeMessages(current, [fresh]));
  };

  useMessageStream((signal) => {
    if (
      signal.type === "resync" ||
      (signal.type === "message.created" && signal.conversationId === id)
    )
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    if (signal.type === "message.updated" && signal.conversationId === id) {
      void refreshOne(signal.messageId).catch(() =>
        queryClient.invalidateQueries({ queryKey: ["messages"] }),
      );
      void queryClient.invalidateQueries({
        queryKey: ["messages", "conversations"],
      });
    }
  });

  // a képernyő elhagyásakor a futó feltöltések leállnak
  useEffect(() => {
    const jobs = uploadJobs.current;
    return () => jobs.forEach((job) => job.handle?.abort());
  }, []);

  // OLVASOTT: a legutolsó más által küldött üzenet, amíg az app előtérben van
  useEffect(() => {
    const latest = [...items]
      .reverse()
      .find((m) => m.senderUserId !== user?.id);
    if (!id || !latest || latest.id === lastMarked.current) return;
    if (AppState.currentState !== "active") return;
    lastMarked.current = latest.id;
    void markConversationRead(id, { messageId: latest.id })
      .then(() => queryClient.invalidateQueries({ queryKey: ["messages"] }))
      .catch(() => {
        lastMarked.current = null;
      });
  }, [id, items, queryClient, user?.id]);

  const loadOlder = async () => {
    if (!id || !cursor) return;
    setOlderCursor(null);
    try {
      const page = await getMessagePage(id, cursor);
      setOlder((current) => mergeMessages(current, page.items));
      setOlderCursor(page.olderCursor);
    } catch {
      setOlderCursor(cursor);
    }
  };

  const deliver = async (message: OutgoingMessage) => {
    if (!id) return;
    try {
      const confirmed = await sendMessage(id, {
        ...(message.text ? { text: message.text } : {}),
        clientMessageId: message.clientMessageId,
        ...(message.attachmentIds?.length
          ? { attachmentIds: message.attachmentIds }
          : {}),
        ...(message.replyToMessageId
          ? { replyToMessageId: message.replyToMessageId }
          : {}),
      });
      setSent((current) => mergeMessages(current, [confirmed]));
      dispatch({ type: "removed", clientMessageId: message.clientMessageId });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    } catch {
      dispatch({ type: "failed", clientMessageId: message.clientMessageId });
    }
  };

  const startUpload = (localId: string, file: AttachmentUploadFile) => {
    if (!id) return;
    const handle = uploadMessageAttachment(id, file, (percent) =>
      dispatchUpload({ type: "progress", localId, percent }),
    );
    uploadJobs.current.set(localId, { file, handle });
    handle.promise
      .then((attachment) =>
        dispatchUpload({ type: "done", localId, attachmentId: attachment.id }),
      )
      .catch((error: unknown) => {
        if (error instanceof UploadAbortedError) return;
        dispatchUpload({
          type: "failed",
          localId,
          error: uploadErrorText(error),
        });
      });
  };

  const addPicked = (result: PhotoPickResult) => {
    setAttachOpen(false);
    if (result.kind === "cancelled") return;
    if (result.kind === "denied") {
      setActionNotice(result.notice);
      return;
    }
    const sizes = new Map(
      result.assets.map((asset: ImagePicker.ImagePickerAsset) => [
        asset.uri,
        asset.fileSize ?? 0,
      ]),
    );
    const { files, skipped } = toPickedImages(result.assets);
    const room = MESSAGE_ATTACHMENTS_MAX - uploads.length;
    const accepted = files.slice(0, Math.max(0, room));
    const notes: string[] = [];
    if (skipped.length)
      notes.push(`Kimaradt (csak JPEG és PNG megy): ${skipped.join(", ")}.`);
    if (files.length > accepted.length)
      notes.push(
        `Egy üzenethez legfeljebb ${MESSAGE_ATTACHMENTS_MAX} csatolmány tartozhat.`,
      );
    setActionNotice(notes.length ? notes.join(" ") : null);
    for (const file of accepted) {
      const localId = newClientMessageId();
      dispatchUpload({
        type: "added",
        upload: {
          localId,
          fileName: file.name,
          sizeBytes: sizes.get(file.uri) ?? 0,
        },
      });
      startUpload(localId, file);
    }
  };

  const retryUpload = (localId: string) => {
    const job = uploadJobs.current.get(localId);
    if (!job) return;
    dispatchUpload({ type: "retried", localId });
    startUpload(localId, job.file);
  };

  const removeUpload = (localId: string) => {
    uploadJobs.current.get(localId)?.handle?.abort();
    uploadJobs.current.delete(localId);
    dispatchUpload({ type: "removed", localId });
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const fresh = await editMessage(editing.id, { text: draft.trim() });
      setSent((current) => mergeMessages(current, [fresh]));
      setEditing(null);
      setDraft("");
      setActionNotice(null);
    } catch (error) {
      setActionNotice(
        error instanceof ApiError
          ? error.message
          : "A szerkesztés nem mentődött el.",
      );
    }
  };

  const send = () => {
    if (editing) {
      void saveEdit();
      return;
    }
    const text = draft.trim();
    if (!id || !canSend(text, uploads)) return;
    const message: OutgoingMessage = {
      clientMessageId: newClientMessageId(),
      conversationId: id,
      text,
      attachmentIds: readyAttachmentIds(uploads),
      ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "queued", message });
    setDraft("");
    setReplyTo(null);
    dispatchUpload({ type: "cleared" });
    uploadJobs.current.clear();
    void deliver(message);
  };

  const react = async (
    message: MessageItem,
    reaction: MessageReactionValue,
    mine: boolean,
  ) => {
    setActionsFor(null);
    try {
      const fresh = mine
        ? await removeReaction(message.id, reaction)
        : await addReaction(message.id, { reaction });
      setSent((current) => mergeMessages(current, [fresh]));
    } catch {
      setActionNotice("A reakció nem mentődött el.");
    }
  };

  const remove = async (message: MessageItem) => {
    try {
      await deleteMessage(message.id);
      await refreshOne(message.id);
      void queryClient.invalidateQueries({
        queryKey: ["messages", "conversations"],
      });
    } catch {
      setActionNotice("Az üzenet nem törlődött.");
    }
  };

  const confirmRemove = (message: MessageItem) => {
    setActionsFor(null);
    Alert.alert(
      "Törlöd az üzenetet?",
      "Az üzenet helyén mindenkinél az „Az üzenetet törölték.” felirat marad, a szövege és a csatolmányai nem látszanak többé. A törlés nem vonható vissza.",
      [
        { text: "Mégsem", style: "cancel" },
        {
          text: "Törlés",
          style: "destructive",
          onPress: () => void remove(message),
        },
      ],
    );
  };

  const startEdit = (message: MessageItem) => {
    setActionsFor(null);
    setReplyTo(null);
    setAttachOpen(false);
    setEditing(message);
    setDraft(message.text ?? "");
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  if (status !== "authenticated") return <Redirect href="/login" />;

  const now = new Date();
  const pending = id ? visibleOutgoing(outbox, id, items) : [];
  const rows: Row[] = [];
  items.forEach((message, index) => {
    const label = dayDividerLabel(message.createdAt, now);
    const previous = items[index - 1];
    if (!previous || dayDividerLabel(previous.createdAt, now) !== label)
      rows.push({ kind: "divider", key: `d-${message.id}`, label });
    rows.push({ kind: "message", key: message.id, message });
  });
  pending.forEach((message) =>
    rows.push({ kind: "pending", key: message.clientMessageId, message }),
  );
  const name = conversation ? conversationName(conversation) : "Beszélgetés";
  const sendable = editing
    ? Boolean(draft.trim()) || editing.attachments.length > 0
    : canSend(draft, uploads);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Vissza"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={22} color={tokens.textPrimary} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {name}
        </Text>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          inverted
          data={[...rows].reverse()}
          keyExtractor={(row) => row.key}
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.2}
          contentContainerStyle={styles.list}
          renderItem={({ item: row }) => {
            if (row.kind === "divider")
              return <Text style={styles.divider}>{row.label}</Text>;
            if (row.kind === "message") {
              const message = row.message;
              const own = message.senderUserId === user?.id;
              return (
                <MessageBubble
                  message={message}
                  own={own}
                  sender={
                    conversation?.type === "GROUP" && !own
                      ? message.senderName
                      : null
                  }
                  tokens={tokens}
                  onLongPress={
                    message.deleted
                      ? null
                      : () => {
                          setAttachOpen(false);
                          setActionsFor(message);
                        }
                  }
                  onToggleReaction={(reaction, mine) =>
                    void react(message, reaction, mine)
                  }
                  onOpenImage={setBigImage}
                />
              );
            }
            const message = row.message;
            return (
              <View>
                <PendingBubble
                  text={message.text}
                  attachmentCount={message.attachmentIds?.length ?? 0}
                  time={message.createdAt}
                  pending={message.status === "pending"}
                  tokens={tokens}
                />
                {message.status === "failed" ? (
                  <View style={styles.failedRow}>
                    <Text style={styles.failedText}>
                      Nem sikerült elküldeni.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        dispatch({
                          type: "retried",
                          clientMessageId: message.clientMessageId,
                        });
                        void deliver(message);
                      }}
                    >
                      <Text style={styles.failedAction}>Újra</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        dispatch({
                          type: "removed",
                          clientMessageId: message.clientMessageId,
                        })
                      }
                    >
                      <Text style={styles.failedAction}>Törlés</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
        {actionNotice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Koppintásra eltűnik"
            onPress={() => setActionNotice(null)}
          >
            <Text style={styles.notice}>{actionNotice}</Text>
          </Pressable>
        ) : null}
        {actionsFor ? (
          <MessageActionsPanel
            message={actionsFor}
            own={actionsFor.senderUserId === user?.id}
            tokens={tokens}
            onReact={(reaction, mine) => void react(actionsFor, reaction, mine)}
            onReply={() => {
              setEditing(null);
              setReplyTo(actionsFor);
              setActionsFor(null);
            }}
            onEdit={() => startEdit(actionsFor)}
            onDelete={() => confirmRemove(actionsFor)}
            onClose={() => setActionsFor(null)}
          />
        ) : null}
        {attachOpen ? (
          <AttachPanel
            tokens={tokens}
            onCamera={() => void takePhotoFromCamera().then(addPicked)}
            onLibrary={() => void pickPhotosFromLibrary().then(addPicked)}
            onClose={() => setAttachOpen(false)}
          />
        ) : null}
        {replyTo || editing ? (
          <View style={styles.banner}>
            <View style={styles.bannerBody}>
              <Text style={styles.bannerTitle}>
                {editing
                  ? "Üzenet szerkesztése"
                  : `Válasz neki: ${replyTo!.senderName}`}
              </Text>
              {replyTo ? (
                <Text style={styles.bannerText} numberOfLines={1}>
                  {previewText(replyTo)}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                editing ? "Szerkesztés megszakítása" : "Válasz megszakítása"
              }
              onPress={() => (editing ? cancelEdit() : setReplyTo(null))}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color={tokens.textSecondary} />
            </Pressable>
          </View>
        ) : null}
        {uploads.length && !editing ? (
          <UploadChips
            uploads={uploads}
            canRetry={(localId) => uploadJobs.current.has(localId)}
            tokens={tokens}
            onRetry={retryUpload}
            onRemove={removeUpload}
          />
        ) : null}
        <View style={styles.composer}>
          {editing ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Csatolmány hozzáadása"
              onPress={() => {
                setActionsFor(null);
                setAttachOpen((open) => !open);
              }}
              style={styles.attach}
            >
              <Ionicons name="attach" size={22} color={tokens.textSecondary} />
            </Pressable>
          )}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Üzenet…"
            placeholderTextColor={tokens.textMuted}
            multiline
            maxLength={4000}
            style={styles.input}
            accessibilityLabel="Üzenet"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? "Mentés" : "Küldés"}
            disabled={!sendable}
            onPress={send}
            style={[styles.send, !sendable && styles.sendDisabled]}
          >
            <Ionicons
              name={editing ? "checkmark" : "send"}
              size={18}
              color={tokens.textOnAccent}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      {bigImage ? (
        <View style={overlayStyles.overlay}>
          <DocumentImage
            ownerPath="/messages"
            collection="attachments"
            documentId={bigImage.id}
            variant="original"
            style={overlayStyles.image}
            hibaStyle={overlayStyles.imageError}
            resizeMode="contain"
            accessibilityLabel={bigImage.fileName}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setBigImage(null)}
            style={overlayStyles.close}
          >
            <Text style={overlayStyles.closeText}>Bezárás</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** A nagy kép rátétje, az eszköz adatlapjának mintájára (sötét, a téma nélkül). */
const overlayStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#03101acc",
    justifyContent: "center",
    gap: 16,
    padding: 20,
  },
  image: { flex: 1, width: "100%" },
  imageError: { alignItems: "center", justifyContent: "center", padding: 16 },
  close: {
    backgroundColor: "#12384c",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  closeText: { color: "#eaf4fa", textAlign: "center" },
});

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    flex: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    back: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.background,
    },
    title: { flex: 1, color: t.textPrimary, fontSize: 24, fontWeight: "700" },
    notice: {
      color: t.warning,
      backgroundColor: t.warningSoft,
      padding: 10,
      fontSize: 13,
    },
    list: { padding: 16, gap: 12 },
    divider: {
      color: t.textMuted,
      fontSize: 12,
      textAlign: "center",
      paddingVertical: 6,
    },
    failedRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 12,
      marginTop: 4,
    },
    failedText: { color: t.danger, fontSize: 12 },
    failedAction: { color: t.accent, fontSize: 12, fontWeight: "600" },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: t.surface,
      borderTopWidth: 1,
      borderTopColor: t.border,
      borderLeftWidth: 3,
      borderLeftColor: t.accent,
    },
    bannerBody: { flex: 1, minWidth: 0, gap: 2 },
    bannerTitle: { color: t.accentSoftText, fontSize: 12, fontWeight: "600" },
    bannerText: { color: t.textSecondary, fontSize: 13 },
    attach: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      padding: 12,
      backgroundColor: t.surface,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 140,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.background,
      color: t.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    send: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.accent,
    },
    sendDisabled: { opacity: 0.4 },
  });
