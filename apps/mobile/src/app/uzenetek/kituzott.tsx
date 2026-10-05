import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import { getPins } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { pinnedMeta } from "@/lib/messages/phase3";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * KITŰZÖTT ELEMEK (Figma 454:596). Egy elemre koppintva a beszélgetés a
 * kitűzött üzenethez ugrik. Kitűzni és levenni az üzenet műveletei közül lehet.
 */
export default function PinnedItemsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const pins = useQuery({
    queryKey: ["messages", "pins", id],
    queryFn: () => getPins(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const now = new Date();

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Kitűzött elemek" tokens={tokens} />
      <ScrollView contentContainerStyle={styles.content}>
        {pins.error ? (
          <Text style={styles.error}>A kitűzött elemek nem töltődtek be.</Text>
        ) : null}
        {pins.data?.items.map((pin) => (
          <Pressable
            key={pin.messageId}
            accessibilityRole="button"
            onPress={() =>
              router.navigate({
                pathname: "/uzenetek/[id]",
                params: { id: id!, jump: pin.messageId },
              })
            }
            style={styles.card}
          >
            <Text style={styles.cardTitle} numberOfLines={2}>
              📌 {pin.title}
            </Text>
            <Text style={styles.cardMeta}>{pinnedMeta(pin, now)}</Text>
          </Pressable>
        ))}
        {pins.data && pins.data.items.length === 0 ? (
          <View>
            <Text style={styles.cardTitle}>Nincs kitűzött elem</Text>
            <Text style={styles.lead}>
              A fontos üzeneteket itt gyűjti a rendszer.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
