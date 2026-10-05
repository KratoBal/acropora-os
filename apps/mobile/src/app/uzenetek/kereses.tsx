import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import { searchConversation } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { searchCountLabel, searchHitMeta } from "@/lib/messages/phase3";
import { MESSAGE_SEARCH_MIN_LENGTH } from "@/lib/messages/types";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * KERESÉS A BESZÉLGETÉSBEN (Figma 454:533; Balázs, 2026-10-05: csak a
 * megnyitottban). Az „Ugrás” visszavisz a beszélgetésbe, a találathoz.
 */
export default function ConversationSearchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const ready = [...debounced].length >= MESSAGE_SEARCH_MIN_LENGTH;
  const result = useQuery({
    queryKey: ["messages", "search", id, debounced],
    queryFn: () => searchConversation(id!, debounced),
    enabled: status === "authenticated" && Boolean(id) && ready,
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const now = new Date();

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Keresés" tokens={tokens} />
      <ScrollView contentContainerStyle={styles.content}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          maxLength={100}
          placeholder="Keresés a beszélgetésben…"
          placeholderTextColor={tokens.textMuted}
          style={styles.input}
          accessibilityLabel="Keresés a beszélgetésben"
        />
        {result.error ? (
          <Text style={styles.error}>A keresés nem sikerült.</Text>
        ) : null}
        {ready && result.data ? (
          result.data.items.length === 0 ? (
            <View>
              <Text style={styles.cardTitle}>Nincs találat</Text>
              <Text style={styles.lead}>
                Próbálj másik kifejezést vagy rövidebb keresést.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.muted}>
                {searchCountLabel(result.data.total, result.data.totalCapped)}
              </Text>
              {result.data.items.map((hit) => (
                <View key={hit.messageId} style={styles.card}>
                  <Text style={styles.cardMeta}>{searchHitMeta(hit, now)}</Text>
                  <Text style={styles.cardText}>{hit.snippet}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.navigate({
                        pathname: "/uzenetek/[id]",
                        params: { id: id!, jump: hit.messageId },
                      })
                    }
                  >
                    <Text style={styles.link}>Ugrás</Text>
                  </Pressable>
                </View>
              ))}
            </>
          )
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
