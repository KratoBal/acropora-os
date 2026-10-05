import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Monogram, conversationName } from "@/components/messages/MessageParts";
import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import { ApiError, ApiNetworkError } from "@/lib/api/client";
import { forwardMessage, listConversations } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { newClientMessageId } from "@/lib/messages/outbox";
import type { ConversationListItem } from "@/lib/messages/types";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * TOVÁBBÍTÁS (a prompt 9. pontja; Balázs, 2026-10-05: az eredeti szerző
 * látszik). Egy cél kérésenként, a mostani beszélgetés nem cél. A kliens-
 * azonosító a képernyő megnyitásakor készül, így egy hiba utáni újrapróbálás
 * nem továbbít kétszer.
 */
export default function ForwardScreen() {
  const { messageId, from } = useLocalSearchParams<{
    messageId: string;
    from: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const [clientMessageId] = useState(() => newClientMessageId());
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ConversationListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["messages", "conversations"],
    queryFn: listConversations,
    enabled: status === "authenticated",
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const needle = query.trim().toLowerCase();
  const targets = (list.data?.items ?? []).filter(
    (item) =>
      item.id !== from &&
      (!needle || conversationName(item).toLowerCase().includes(needle)),
  );

  const forward = async () => {
    if (!messageId || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      await forwardMessage(messageId, {
        conversationId: chosen.id,
        clientMessageId,
      });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.back();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof ApiNetworkError
            ? "Nincs kapcsolat. Próbáld újra."
            : "A továbbítás nem sikerült.",
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Továbbítás" tokens={tokens} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>
          Válaszd ki, melyik beszélgetésbe menjen. Az eredeti szerző neve
          látszani fog.
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Beszélgetés keresése…"
          placeholderTextColor={tokens.textMuted}
          style={styles.input}
          accessibilityLabel="Beszélgetés keresése"
        />
        {targets.map((item) => {
          const label = conversationName(item);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen?.id === item.id }}
              onPress={() => setChosen(item)}
              style={[
                styles.card,
                styles.row,
                chosen?.id === item.id && styles.cardChosen,
              ]}
            >
              <Monogram name={label} tokens={tokens} />
              <Text style={styles.cardTitle} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
        {list.data && targets.length === 0 ? (
          <Text style={styles.lead}>Nincs találat.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View>
          <Pressable
            accessibilityRole="button"
            disabled={busy || !chosen}
            onPress={() => void forward()}
            style={[
              styles.primary,
              (busy || !chosen) && styles.primaryDisabled,
            ]}
          >
            <Text style={styles.primaryText}>Továbbítás</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
