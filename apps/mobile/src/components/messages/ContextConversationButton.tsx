import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { openContextConversation } from "@/lib/api/messages";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * „BESZÉLGETÉS” A MUNKALAPON ÉS A HIBAJEGYEN (Üzenetek 4. fázis): a tárgy élő
 * beszélgetését nyitja, vagy egy újat indít; a szerver dönt és a kérdezőt
 * felveszi. Elutasításnál a szerver mondata látszik.
 */
export function ContextConversationButton({
  kind,
  objectId,
  tokens,
}: {
  kind: "worksheet" | "service-job";
  objectId: string;
  tokens: ThemeTokens;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const styles = buttonStyles(tokens);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const conversation = await openContextConversation(kind, objectId);
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.push({
        pathname: "/uzenetek/[id]",
        params: { id: conversation.id },
      });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A beszélgetés nem nyílt meg.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Beszélgetés"
        disabled={busy}
        onPress={() => void open()}
        style={[styles.button, busy && styles.busy]}
      >
        <Ionicons
          name="chatbubbles-outline"
          size={18}
          color={tokens.textPrimary}
        />
        <Text style={styles.text}>Beszélgetés</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const buttonStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    wrap: { gap: 4, alignItems: "flex-start" },
    button: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    busy: { opacity: 0.5 },
    text: { color: t.textPrimary, fontSize: 15, fontWeight: "600" },
    error: { color: t.danger, fontSize: 13 },
  });
