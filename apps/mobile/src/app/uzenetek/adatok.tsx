import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Monogram, conversationName } from "@/components/messages/MessageParts";
import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import {
  getConversation,
  leaveConversation,
  unlinkConversationContext,
} from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { notificationLabel } from "@/lib/messages/phase3";
import {
  canManageMembers,
  contextCardParts,
  contextCardTitle,
} from "@/lib/messages/phase4";
import { ROLE_LABELS } from "@/lib/messages/role-labels";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * A BESZÉLGETÉS ADATAI (Figma 450:474): név, résztvevők, és innen a fájlok és
 * az értesítések. A 4. fázistól csoportban: tag hozzáadása, a kötés munkalaphoz
 * vagy hibajegyhez (és a leválasztás), és a kilépés, megerősítés után.
 */
export default function ConversationDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["messages", "detail", id],
    queryFn: () => getConversation(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const conversation = detail.data;

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["messages"] });
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message ? cause.message : failure,
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  // a kilépés előtt rákérdez: utána a beszélgetés eltűnik a listáról
  const confirmLeave = () =>
    Alert.alert(
      "Kilépsz a beszélgetésből?",
      "Nem kapsz több üzenetet ebből a csoportból. Visszakerülni csak úgy tudsz, ha egy tag újra hozzáad.",
      [
        { text: "Mégse", style: "cancel" },
        {
          text: "Kilépés",
          style: "destructive",
          onPress: () =>
            void run(
              () => leaveConversation(id!),
              "A kilépés nem sikerült.",
            ).then((left) => {
              if (left)
                // a beszélgetés is lekerül a veremről: abba már nem lehet visszalépni
                router.dismissTo("/uzenetek");
            }),
        },
      ],
    );
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
            {canManageMembers(conversation.type) ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Kapcsolás</Text>
                {conversation.context ? (
                  <>
                    <Text style={styles.cardMeta}>
                      {contextCardTitle(conversation.context.type)} ·{" "}
                      {contextCardParts(conversation.context).join(" · ")}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() =>
                        void run(
                          () => unlinkConversationContext(id!),
                          "A leválasztás nem sikerült.",
                        )
                      }
                    >
                      <Text style={styles.error}>Leválasztás</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: "/uzenetek/kapcsolas",
                        params: { id: id! },
                      })
                    }
                  >
                    <Text style={styles.link}>
                      Kapcsolás munkalaphoz vagy hibajegyhez
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.sectionTitle}>Résztvevők</Text>
            {canManageMembers(conversation.type) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/uzenetek/tagok",
                    params: { id: id! },
                  })
                }
              >
                <Text style={styles.link}>+ Tag hozzáadása</Text>
              </Pressable>
            ) : null}
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
            {canManageMembers(conversation.type) ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={confirmLeave}
                style={styles.card}
              >
                <Text style={styles.error}>Kilépés a beszélgetésből</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
