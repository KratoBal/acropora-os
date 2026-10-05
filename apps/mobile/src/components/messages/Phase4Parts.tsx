import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  contextCardParts,
  contextCardTitle,
  contextRoute,
} from "@/lib/messages/phase4";
import type { ConversationContextCard } from "@/lib/messages/types";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A KAPCSOLT MUNKALAP VAGY HIBAJEGY KÁRTYÁJA a beszélgetés tetején (Figma
 * 450:697): cím, szám, partner, állapot, dátum és „Megnyitás”. Aki a szervizt
 * nem látja, annak csak a szám, „Megnyitás” nélkül.
 */
export function ContextCard({
  card,
  tokens,
}: {
  card: ConversationContextCard;
  tokens: ThemeTokens;
}) {
  const router = useRouter();
  const styles = cardStyles(tokens);
  const route = contextRoute(card);
  return (
    <View style={styles.card} accessibilityLabel="Kapcsolt objektum">
      <View style={styles.body}>
        <Text style={styles.title}>{contextCardTitle(card.type)}</Text>
        <Text style={styles.parts}>{contextCardParts(card).join(" · ")}</Text>
      </View>
      {route ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Megnyitás"
          onPress={() => router.push(route)}
        >
          <Text style={styles.open}>Megnyitás</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A rendszer-esemény (Figma 450:710): középre igazított, halvány sor, buborék nélkül. */
export function SystemMessageLine({
  text,
  tokens,
}: {
  text: string | null;
  tokens: ThemeTokens;
}) {
  return (
    <Text
      style={[cardStyles(tokens).system]}
      accessibilityLabel={text ?? undefined}
    >
      {text}
    </Text>
  );
}

const cardStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    body: { flex: 1, minWidth: 0, gap: 2 },
    title: {
      color: t.warning,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.6,
    },
    parts: { color: t.textSecondary, fontSize: 13 },
    open: { color: t.accent, fontSize: 14, fontWeight: "600" },
    system: {
      color: t.textMuted,
      fontSize: 12,
      textAlign: "center",
      paddingHorizontal: 24,
      paddingVertical: 4,
    },
  });
