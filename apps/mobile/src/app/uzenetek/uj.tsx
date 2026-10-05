import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Monogram } from "@/components/messages/MessageParts";
import { createConversation, searchMessagePeople } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_LABELS } from "@/lib/messages/role-labels";
import type { ConversationPerson } from "@/lib/messages/types";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * ÚJ ÜZENET (Figma 443:347). Egy kiválasztott kolléga a DIRECT beszélgetést
 * nyitja (ha már van, a meglévőt), több egy csoportot, amit el is lehet nevezni.
 */
export default function NewConversationScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [chosen, setChosen] = useState<ConversationPerson[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const people = useQuery({
    queryKey: ["messages", "people", debounced],
    queryFn: () => searchMessagePeople(debounced),
    enabled: status === "authenticated",
  });

  if (status !== "authenticated") return <Redirect href="/login" />;

  const isChosen = (person: ConversationPerson) =>
    chosen.some((c) => c.userId === person.userId);
  const toggle = (person: ConversationPerson) =>
    setChosen((current) =>
      isChosen(person)
        ? current.filter((c) => c.userId !== person.userId)
        : [...current, person],
    );
  const listed = [
    ...chosen,
    ...(people.data?.items ?? []).filter((person) => !isChosen(person)),
  ];

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const conversation = await createConversation({
        memberIds: chosen.map((c) => c.userId),
        ...(chosen.length > 1 && title.trim() ? { title: title.trim() } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.replace({
        pathname: "/uzenetek/[id]",
        params: { id: conversation.id },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A beszélgetés nem indult el.",
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Vissza"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={22} color={tokens.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Új üzenet
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Válassz kollégát vagy indíts csoportos beszélgetést.
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Kolléga keresése…"
          placeholderTextColor={tokens.textMuted}
          style={styles.search}
        />
        {listed.map((person) => {
          const selected = isChosen(person);
          return (
            <Pressable
              key={person.userId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={person.name}
              onPress={() => toggle(person)}
              style={[styles.person, selected && styles.personChosen]}
            >
              <Monogram name={person.name} tokens={tokens} />
              <View style={styles.personBody}>
                <Text style={styles.personName}>{person.name}</Text>
                <Text style={styles.personRole}>
                  {ROLE_LABELS[person.role] ?? ""}
                </Text>
              </View>
              <View style={[styles.box, selected && styles.boxChosen]}>
                {selected ? (
                  <Ionicons
                    name="checkmark"
                    size={16}
                    color={tokens.textOnAccent}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
        {people.data && listed.length === 0 ? (
          <Text style={styles.lead}>Nincs találat.</Text>
        ) : null}
        {chosen.length > 0 ? (
          <Text style={styles.summary}>
            {chosen.length} kiválasztva · {chosen.map((c) => c.name).join(", ")}
          </Text>
        ) : null}
        {chosen.length > 1 ? (
          <TextInput
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholder="A csoport neve (nem kötelező)"
            placeholderTextColor={tokens.textMuted}
            style={styles.search}
          />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || chosen.length === 0}
          onPress={() => void start()}
          style={[
            styles.start,
            (busy || chosen.length === 0) && styles.startDisabled,
          ]}
        >
          <Text style={styles.startText}>Beszélgetés indítása</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    back: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.background,
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "700" },
    content: { padding: 18, gap: 8, paddingBottom: 32 },
    lead: { color: t.textSecondary, fontSize: 14, marginBottom: 8 },
    search: {
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      color: t.textPrimary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 8,
      fontSize: 15,
    },
    person: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      backgroundColor: t.surface,
    },
    personChosen: { backgroundColor: t.warningSoft },
    personBody: { flex: 1, gap: 4 },
    personName: { color: t.textPrimary, fontSize: 15, fontWeight: "600" },
    personRole: { color: t.textSecondary, fontSize: 13 },
    box: {
      width: 24,
      height: 24,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.surface,
    },
    boxChosen: { backgroundColor: t.warning, borderColor: t.warning },
    summary: {
      color: t.warning,
      backgroundColor: t.warningSoft,
      padding: 12,
      marginTop: 8,
      fontSize: 13,
    },
    error: { color: t.danger, fontSize: 13 },
    start: {
      marginTop: 12,
      backgroundColor: t.warning,
      paddingVertical: 16,
      alignItems: "center",
    },
    startDisabled: { opacity: 0.4 },
    startText: { color: t.textOnAccent, fontSize: 16, fontWeight: "600" },
  });
