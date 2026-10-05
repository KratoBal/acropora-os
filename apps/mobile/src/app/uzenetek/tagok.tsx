import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Monogram } from "@/components/messages/MessageParts";
import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import {
  addConversationMembers,
  getConversation,
  searchMessagePeople,
} from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_LABELS } from "@/lib/messages/role-labels";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * TAG HOZZÁADÁSA (Üzenetek 4. fázis, Figma 450:474): az „Új üzenet”
 * kollégaválasztója, a mostani tagok nélkül. A kereshetők listáját és a
 * felvételt a szerver szűri; a hozzáadás sorként látszik a beszélgetésben.
 */
export default function AddMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const detail = useQuery({
    queryKey: ["messages", "detail", id],
    queryFn: () => getConversation(id!),
    enabled: status === "authenticated" && Boolean(id),
  });
  const people = useQuery({
    queryKey: ["messages", "people", debounced],
    queryFn: () => searchMessagePeople(debounced),
    enabled: status === "authenticated",
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const members = new Set((detail.data?.members ?? []).map((m) => m.userId));
  const listed = (people.data?.items ?? []).filter(
    (person) => !members.has(person.userId),
  );
  const toggle = (userId: string) =>
    setChosen((current) =>
      current.includes(userId)
        ? current.filter((c) => c !== userId)
        : [...current, userId],
    );

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await addConversationMembers(id!, { userIds: chosen });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.back();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A hozzáadás nem sikerült.",
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Tag hozzáadása" tokens={tokens} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Válaszd ki, kit veszel fel a csoportba. A hozzáadás látszik a
          beszélgetésben.
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Kolléga keresése…"
          placeholderTextColor={tokens.textMuted}
          style={styles.input}
        />
        {listed.map((person) => {
          const selected = chosen.includes(person.userId);
          return (
            <Pressable
              key={person.userId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={person.name}
              onPress={() => toggle(person.userId)}
              style={[styles.card, styles.row, selected && styles.cardChosen]}
            >
              <Monogram name={person.name} tokens={tokens} />
              <View>
                <Text style={styles.cardTitle}>{person.name}</Text>
                <Text style={styles.cardMeta}>
                  {ROLE_LABELS[person.role] ?? ""}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {people.data && listed.length === 0 ? (
          <Text style={styles.muted}>Nincs találat.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || chosen.length === 0}
          onPress={() => void add()}
          style={[
            styles.primary,
            (busy || chosen.length === 0) && styles.primaryDisabled,
          ]}
        >
          <Text style={styles.primaryText}>Hozzáadás</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
