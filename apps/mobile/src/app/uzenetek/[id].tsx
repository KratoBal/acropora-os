import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
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

import { conversationName } from "@/components/messages/MessageParts";
import { useMessageStream } from "@/components/messages/MessageStream";
import { ApiError, ApiNetworkError } from "@/lib/api/client";
import {
  getConversation,
  getMessagePage,
  markConversationRead,
  sendMessage,
} from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  dayDividerLabel,
  mergeMessages,
  newClientMessageId,
  outboxReducer,
  visibleOutgoing,
  type OutgoingMessage,
} from "@/lib/messages/outbox";
import type { ConversationDetail, MessageItem } from "@/lib/messages/types";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

type Row =
  | { kind: "message"; key: string; message: MessageItem }
  | { kind: "pending"; key: string; message: OutgoingMessage }
  | { kind: "divider"; key: string; label: string };

/**
 * EGY BESZÉLGETÉS (Figma 443:307). Fordított lista: a legújabb lent, a régebbi
 * oldal a lista végére érve töltődik. Egy üzenet addig "küldés…", amíg a szerver
 * vissza nem igazolta; hibánál Újra (ugyanazzal az azonosítóval) és Törlés.
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

  useMessageStream((signal) => {
    if (
      signal.type === "resync" ||
      (signal.type === "message.created" && signal.conversationId === id)
    )
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
  });

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
        text: message.text,
        clientMessageId: message.clientMessageId,
      });
      setSent((current) => mergeMessages(current, [confirmed]));
      dispatch({ type: "removed", clientMessageId: message.clientMessageId });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    } catch {
      dispatch({ type: "failed", clientMessageId: message.clientMessageId });
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !id) return;
    const message: OutgoingMessage = {
      clientMessageId: newClientMessageId(),
      conversationId: id,
      text,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "queued", message });
    setDraft("");
    void deliver(message);
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
                <Bubble
                  styles={styles}
                  own={own}
                  sender={
                    conversation?.type === "GROUP" && !own
                      ? message.senderName
                      : null
                  }
                  text={
                    message.deleted
                      ? "Az üzenetet törölték."
                      : (message.text ?? "")
                  }
                  time={message.createdAt}
                  edited={message.editedAt !== null}
                />
              );
            }
            const message = row.message;
            return (
              <View>
                <Bubble
                  styles={styles}
                  own
                  text={message.text}
                  time={message.createdAt}
                  status={message.status}
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
        <View style={styles.composer}>
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
            accessibilityLabel="Küldés"
            disabled={!draft.trim()}
            onPress={send}
            style={[styles.send, !draft.trim() && styles.sendDisabled]}
          >
            <Ionicons name="send" size={18} color={tokens.textOnAccent} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({
  styles,
  own,
  sender = null,
  text,
  time,
  edited = false,
  status,
}: {
  styles: ReturnType<typeof createStyles>;
  own: boolean;
  sender?: string | null;
  text: string;
  time: string;
  edited?: boolean;
  status?: OutgoingMessage["status"];
}) {
  return (
    <View style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther]}>
      {sender ? <Text style={styles.sender}>{sender}</Text> : null}
      <Text style={styles.bubbleText}>{text}</Text>
      <Text style={styles.bubbleMeta}>
        {new Date(time).toLocaleTimeString("hu-HU", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {edited ? " · szerkesztve" : ""}
        {status === "pending" ? " · küldés…" : ""}
      </Text>
    </View>
  );
}

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
    bubble: { maxWidth: "82%", padding: 12, gap: 6 },
    bubbleOwn: { alignSelf: "flex-end", backgroundColor: t.accentSoft },
    bubbleOther: { alignSelf: "flex-start", backgroundColor: t.surface },
    sender: { color: t.accentSoftText, fontSize: 12, fontWeight: "600" },
    bubbleText: { color: t.textPrimary, fontSize: 15 },
    bubbleMeta: { color: t.textMuted, fontSize: 12, alignSelf: "flex-end" },
    failedRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 12,
      marginTop: 4,
    },
    failedText: { color: t.danger, fontSize: 12 },
    failedAction: { color: t.accent, fontSize: 12, fontWeight: "600" },
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
