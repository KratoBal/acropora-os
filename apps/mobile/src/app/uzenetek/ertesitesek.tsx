import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { conversationName } from "@/components/messages/MessageParts";
import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import { ApiError } from "@/lib/api/client";
import {
  getConversation,
  setConversationNotification,
} from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { notificationLabel, notificationOptions } from "@/lib/messages/phase3";
import type { ConversationNotifyMode } from "@/lib/messages/types";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * ÉRTESÍTÉSEK (Figma 450:630): mikor kapj pusht erről a beszélgetésről. A
 * „Csak említések” most NINCS (Balázs, 2026-10-05); a „Némítás holnapig” a
 * következő reggel 8 óráig tart.
 */
export default function ConversationNotificationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const [choice, setChoice] = useState<ConversationNotifyMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["messages", "detail", id],
    queryFn: () => getConversation(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const now = new Date();
  const state = detail.data?.notification;

  const save = async () => {
    if (!id || !choice) return;
    setBusy(true);
    try {
      await setConversationNotification(id, { mode: choice });
      setChoice(null);
      setMessage("A beállítás elmentve.");
      void queryClient.invalidateQueries({
        queryKey: ["messages", "detail", id],
      });
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "A beállítás nem mentődött el.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Értesítések" tokens={tokens} />
      <ScrollView contentContainerStyle={styles.content}>
        {detail.data ? (
          <Text style={styles.cardTitle}>{conversationName(detail.data)}</Text>
        ) : null}
        <Text style={styles.lead}>
          Állítsd be, mikor kapj push értesítést erről a beszélgetésről.
        </Text>
        <Text style={styles.muted}>Most: {notificationLabel(state, now)}</Text>
        {notificationOptions(state, now).map((option) => (
          <Pressable
            key={option.mode}
            accessibilityRole="radio"
            accessibilityState={{ checked: choice === option.mode }}
            onPress={() => setChoice(option.mode)}
            style={[styles.card, choice === option.mode && styles.cardChosen]}
          >
            <Text style={styles.cardTitle}>{option.label}</Text>
            <Text style={styles.cardMeta}>{option.hint}</Text>
          </Pressable>
        ))}
        {message ? <Text style={styles.notice}>{message}</Text> : null}
        <View>
          <Pressable
            accessibilityRole="button"
            disabled={busy || !choice}
            onPress={() => void save()}
            style={[
              styles.primary,
              (busy || !choice) && styles.primaryDisabled,
            ]}
          >
            <Text style={styles.primaryText}>Beállítások mentése</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
