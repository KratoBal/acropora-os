import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ConversationListItem } from "@/lib/messages/types";
import { conversationTimeLabel, previewText } from "@/lib/messages/outbox";
import type { ThemeTokens } from "@/lib/theme/tokens";

/** A beszélgetés neve: csoportnál a megadott név, DIRECT-nél a másik tag neve. */
export function conversationName(
  item: Pick<ConversationListItem, "title" | "members">,
): string {
  if (item.title) return item.title;
  const names = item.members.map((m) => m.name);
  return names.length > 0 ? names.join(", ") : "Beszélgetés";
}

/** A monogram: a név első két szavának kezdőbetűje (Figma 441:9). */
export function monogram(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function Monogram({
  name,
  tokens,
}: {
  name: string;
  tokens: ThemeTokens;
}) {
  return (
    <View
      style={{
        width: 32,
        height: 40,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tokens.accentSoft,
      }}
    >
      <Text
        style={{
          color: tokens.accentSoftText,
          fontSize: 13,
          fontWeight: "500",
        }}
      >
        {monogram(name)}
      </Text>
    </View>
  );
}

export function lastMessagePreview(item: ConversationListItem): string {
  const last = item.lastMessage;
  if (!last) return "Még nincs üzenet";
  if (last.deleted) return "Az üzenetet törölték.";
  const text = previewText(last);
  return item.type === "GROUP" ? `${last.senderName}: ${text}` : text;
}

/** Egy sor a listában (Figma 443:235): monogram, név, előnézet, idő, olvasatlan-szám. */
export function ConversationRow({
  item,
  now,
  tokens,
  onPress,
}: {
  item: ConversationListItem;
  now: Date;
  tokens: ThemeTokens;
  onPress: () => void;
}) {
  const styles = rowStyles(tokens);
  const name = conversationName(item);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        item.unreadCount > 0 ? `${name}, ${item.unreadCount} olvasatlan` : name
      }
      style={styles.row}
    >
      <Monogram name={name} tokens={tokens} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {lastMessagePreview(item)}
        </Text>
      </View>
      <View style={styles.side}>
        {item.lastMessageAt ? (
          <Text style={styles.time}>
            {conversationTimeLabel(item.lastMessageAt, now)}
          </Text>
        ) : null}
        {item.unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.unreadCount}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const rowStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      padding: 12,
      marginBottom: 8,
      backgroundColor: t.surface,
    },
    body: { flex: 1, minWidth: 0, gap: 4 },
    name: { color: t.textPrimary, fontSize: 15, fontWeight: "600" },
    preview: { color: t.textSecondary, fontSize: 13 },
    side: { alignItems: "flex-end", gap: 6 },
    time: { color: t.textMuted, fontSize: 12 },
    badge: {
      backgroundColor: t.warning,
      paddingHorizontal: 6,
      minWidth: 20,
      alignItems: "center",
    },
    badgeText: { color: t.textOnAccent, fontSize: 12, fontWeight: "600" },
  });
