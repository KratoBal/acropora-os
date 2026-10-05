import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import { linkConversationContext } from "@/lib/api/messages";
import { listServiceJobs } from "@/lib/api/service-jobs";
import { listWorksheets } from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { ConversationContextType } from "@/lib/messages/types";
import { useAppTheme } from "@/lib/theme/useAppTheme";

type Candidate = { id: string; number: string; partner: string | null };

/**
 * KAPCSOLÁS MUNKALAPHOZ VAGY HIBAJEGYHEZ (Üzenetek 4. fázis): szám szerinti
 * keresés a szerviz-listákon (a szerver keres). A kötést a szerver ellenőrzi:
 * a szervizjog, és hogy a tárgynak nincs-e már beszélgetése.
 */
export default function LinkContextScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const [type, setType] = useState<ConversationContextType>("WORKSHEET");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const candidates = useQuery({
    queryKey: ["messages", "link-candidates", type, debounced],
    queryFn: async (): Promise<Candidate[]> =>
      type === "WORKSHEET"
        ? (await listWorksheets({ search: debounced, pageSize: 10 })).items.map(
            (item) => ({
              id: item.id,
              number: item.number ?? item.label ?? "szám nélkül",
              partner: item.customerName,
            }),
          )
        : (await listServiceJobs("all", "ALL", debounced)).items
            .slice(0, 10)
            .map((item) => ({
              id: item.id,
              number: item.jobNumber,
              partner: item.customerName,
            })),
    enabled: status === "authenticated" && debounced.length > 0,
  });

  if (status !== "authenticated") return <Redirect href="/login" />;

  const link = async (candidate: Candidate) => {
    setBusy(true);
    setError(null);
    try {
      await linkConversationContext(id!, { type, id: candidate.id });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.back();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kapcsolás nem sikerült.",
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Kapcsolás" tokens={tokens} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Keresd meg a munkalapot vagy a hibajegyet a száma szerint.
        </Text>
        <View style={styles.tabs} accessibilityRole="radiogroup">
          {(
            [
              ["WORKSHEET", "Munkalap"],
              ["SERVICE_JOB", "Hibajegy"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: type === value }}
              accessibilityLabel={label}
              onPress={() => setType(value)}
              style={[styles.tab, type === value && styles.tabActive]}
            >
              <Text
                style={[styles.tabText, type === value && styles.tabTextActive]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Szám keresése"
          placeholder={
            type === "WORKSHEET" ? "pl. BIO-2026-001" : "a hibajegy száma"
          }
          placeholderTextColor={tokens.textMuted}
          style={styles.input}
          autoCapitalize="characters"
        />
        {(candidates.data ?? []).map((candidate) => (
          <Pressable
            key={candidate.id}
            accessibilityRole="button"
            accessibilityLabel={candidate.number}
            disabled={busy}
            onPress={() => void link(candidate)}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>{candidate.number}</Text>
            {candidate.partner ? (
              <Text style={styles.cardMeta}>{candidate.partner}</Text>
            ) : null}
          </Pressable>
        ))}
        {candidates.data && candidates.data.length === 0 ? (
          <Text style={styles.muted}>Nincs találat.</Text>
        ) : null}
        {candidates.error ? (
          <Text style={styles.error}>A keresés nem sikerült.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
