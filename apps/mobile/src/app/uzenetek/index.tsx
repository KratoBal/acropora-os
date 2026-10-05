import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "@/components/home/BottomNav";
import {
  ConversationRow,
  conversationName,
} from "@/components/messages/MessageParts";
import { useMessageStream } from "@/components/messages/MessageStream";
import { ApiError, ApiNetworkError } from "@/lib/api/client";
import { listConversations } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

const MESSAGES_LIST_KEY = ["messages", "conversations"] as const;

/**
 * AZ ÜZENETEK LISTÁJA (Figma 443:235). A folyam minden jelzésére újraolvas; a
 * lista a beszélgetésre koppintva nyitja a beszélgetést.
 */
export default function MessagesScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");

  const list = useQuery({
    queryKey: MESSAGES_LIST_KEY,
    queryFn: listConversations,
    enabled: status === "authenticated",
  });

  useMessageStream(() => {
    void queryClient.invalidateQueries({ queryKey: ["messages"] });
  });

  if (status !== "authenticated") return <Redirect href="/login" />;

  const now = new Date();
  const needle = filter.trim().toLowerCase();
  const items = (list.data?.items ?? []).filter(
    (item) =>
      !needle ||
      conversationName(item).toLowerCase().includes(needle) ||
      (item.lastMessage?.text ?? "").toLowerCase().includes(needle),
  );
  const forbidden = list.error instanceof ApiError && list.error.status === 403;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Üzenetek
        </Text>
        {!forbidden ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Új üzenet"
            onPress={() => router.push("/uzenetek/uj")}
            style={styles.newButton}
          >
            <Ionicons name="add" size={22} color={tokens.warning} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching}
            onRefresh={() => void list.refetch()}
          />
        }
      >
        {list.error instanceof ApiNetworkError ? (
          <Text style={styles.offline}>Offline mód: a lista nem frissült.</Text>
        ) : null}
        {forbidden ? (
          <Text style={styles.empty}>
            Az Üzenetek nem érhetők el ezzel a fiókkal.
          </Text>
        ) : (
          <>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Keresés"
              placeholderTextColor={tokens.textMuted}
              style={styles.search}
            />
            {list.isLoading ? (
              <Text style={styles.empty}>Betöltés…</Text>
            ) : null}
            {list.data && items.length === 0 ? (
              <Text style={styles.empty}>
                {list.data.items.length === 0
                  ? "Még nincs beszélgetésed. Indíts egyet a + gombbal."
                  : "Nincs találat."}
              </Text>
            ) : null}
            {items.map((item) => (
              <ConversationRow
                key={item.id}
                item={item}
                now={now}
                tokens={tokens}
                onPress={() =>
                  router.push({
                    pathname: "/uzenetek/[id]",
                    params: { id: item.id },
                  })
                }
              />
            ))}
          </>
        )}
      </ScrollView>
      <BottomNav active="messages" />
    </SafeAreaView>
  );
}

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 18,
      paddingVertical: 12,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "700" },
    newButton: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.warningSoft,
    },
    content: { padding: 18, paddingBottom: 32 },
    search: {
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      color: t.textPrimary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 16,
      fontSize: 15,
    },
    empty: { color: t.textSecondary, fontSize: 14, paddingVertical: 12 },
    offline: {
      color: t.warning,
      backgroundColor: t.warningSoft,
      padding: 10,
      marginBottom: 12,
      fontSize: 13,
    },
  });
