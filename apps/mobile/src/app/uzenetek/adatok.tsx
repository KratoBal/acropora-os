import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Monogram, conversationName } from "@/components/messages/MessageParts";
import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import { getConversation } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { notificationLabel } from "@/lib/messages/phase3";
import { ROLE_LABELS } from "@/lib/messages/role-labels";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * A BESZÉLGETÉS ADATAI (Figma 450:474): név, résztvevők, és innen a fájlok és
 * az értesítések. Kilépés és tag hozzáadása NINCS (Balázs, 2026-10-05: egy
 * következő lépés).
 */
export default function ConversationDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const detail = useQuery({
    queryKey: ["messages", "detail", id],
    queryFn: () => getConversation(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const conversation = detail.data;
  const name = conversation ? conversationName(conversation) : "";
  const now = new Date();

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Beszélgetés adatai" tokens={tokens} />
      <ScrollView contentContainerStyle={styles.content}>
        {detail.error ? (
          <Text style={styles.error}>Az adatok nem töltődtek be.</Text>
        ) : null}
        {conversation ? (
          <>
            <View style={styles.row}>
              <Monogram name={name} tokens={tokens} />
              <View>
                <Text style={styles.cardTitle}>{name}</Text>
                <Text style={styles.muted}>
                  {conversation.members.length + 1} résztvevő
                </Text>
              </View>
            </View>
            <View style={styles.tabs}>
              <Pressable
                accessibilityRole="button"
                style={styles.tab}
                onPress={() =>
                  router.push({
                    pathname: "/uzenetek/megosztott",
                    params: { id: id! },
                  })
                }
              >
                <Ionicons
                  name="folder-outline"
                  size={20}
                  color={tokens.textPrimary}
                />
                <Text style={styles.tabText}>Fájlok</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.tab}
                onPress={() =>
                  router.push({
                    pathname: "/uzenetek/ertesitesek",
                    params: { id: id! },
                  })
                }
              >
                <Ionicons
                  name="notifications-outline"
                  size={20}
                  color={tokens.textPrimary}
                />
                <Text style={styles.tabText}>Értesítések</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              Értesítések: {notificationLabel(conversation.notification, now)}
            </Text>
            <Text style={styles.sectionTitle}>Résztvevők</Text>
            {conversation.members.map((member) => (
              <View key={member.userId} style={[styles.card, styles.row]}>
                <Monogram name={member.name} tokens={tokens} />
                <View>
                  <Text style={styles.cardTitle}>{member.name}</Text>
                  <Text style={styles.cardMeta}>
                    {ROLE_LABELS[member.role] ?? member.role}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
