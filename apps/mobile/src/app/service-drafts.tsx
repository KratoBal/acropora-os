import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  acceptServiceDraft,
  listPendingServiceDrafts,
  rejectServiceDraft,
  type ServiceDraftListItem,
  type ServiceDraftListResponse,
} from "@/lib/api/service-drafts";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  acceptBlocker,
  acceptInput,
  canReviewServiceDrafts,
  draftFilterLabel,
  draftMetaLine,
} from "@/lib/service-drafts/presentation";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A CÁPASULI PISZKOZATOK A TELEFONON (kártya 49210cdd).
 *
 * IDE VISZ az „Új Cápasuli piszkozatok” értesítés (`serviceDrafts` célpont).
 * Addig a koppintás a nyitólapra vitt, mert a Piszkozatok oldal csak a weben
 * létezett (Balázs kapta így 2026-10-06 17:05-kor).
 *
 * A várakozó kérések listája, és a döntés róluk, ugyanúgy, mint a weben:
 * elfogadás helyszínnel és a jelentő szerzőjével (utána a megnyílt hibajegyre
 * visz), vagy elvetés (megerősítéssel: a telefonon a félrekoppintás
 * gyakoribb). A kiszűrt tételek és a „Mégis piszkozat” a weben maradnak, és ezt
 * a képernyő ki is mondja. Az értesítés `id` paramétere (a levél azonosítója)
 * itt nem kell: a lista a levél ÖSSZES várakozó kérését úgyis mutatja.
 */
export default function ServiceDraftsScreen() {
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const allowed = canReviewServiceDrafts(user);
  const drafts = useQuery({
    queryKey: ["service-drafts", "PENDING"],
    queryFn: listPendingServiceDrafts,
    enabled: status === "authenticated" && allowed,
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;

  if (!allowed)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.title}>Nincs hozzáférésed</Text>
          <Text style={styles.hint}>
            A piszkozatokat csak a belső adminisztrátorok látják.
          </Text>
        </View>
      </SafeAreaView>
    );

  const items = drafts.data?.items ?? [];
  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FlatList
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={drafts.isRefetching && !drafts.isPending}
            onRefresh={() => void drafts.refetch()}
            tintColor={tokens.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Várakozó piszkozatok</Text>
            <Text style={styles.hint}>
              {drafts.data
                ? `${items.length}${drafts.data.nextCursor ? "+" : ""} kérés vár elbírálásra.`
                : "A Cápasuli napi jelentőiből."}{" "}
              A kiszűrt tételek a weben vannak (Szerviz / Piszkozatok).
            </Text>
            {drafts.isPending ? (
              <ActivityIndicator color={tokens.accent} size="large" />
            ) : null}
            {drafts.isError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>
                  {drafts.error instanceof Error
                    ? drafts.error.message
                    : "A piszkozatok betöltése nem sikerült."}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void drafts.refetch()}
                  style={({ pressed }) => [
                    styles.retry,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.retryText}>Újrapróbálás</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          drafts.isSuccess ? (
            <View style={styles.card}>
              <Text style={styles.hint}>Nincs várakozó piszkozat.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <DraftCard
            item={item}
            data={drafts.data!}
            styles={styles}
            tokens={tokens}
          />
        )}
      />
    </SafeAreaView>
  );
}

function DraftCard({
  item,
  data,
  styles,
  tokens,
}: {
  item: ServiceDraftListItem;
  data: ServiceDraftListResponse;
  styles: ReturnType<typeof createStyles>;
  tokens: ThemeTokens;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // a javasolt helyszín csak akkor előválasztás, ha a listán is ott áll
  const [department, setDepartment] = useState(
    data.locations.some((l) => l.id === item.proposedDepartmentId)
      ? item.proposedDepartmentId!
      : "",
  );
  const [author, setAuthor] = useState(item.reporterPersonName ?? "");
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["service-drafts"] });
  const accept = useMutation({
    mutationFn: () =>
      acceptServiceDraft(item.id, acceptInput(department, author)),
    onSuccess: (result) => {
      void refresh();
      router.push({
        pathname: "/service-jobs/[id]",
        params: { id: result.serviceJobId },
      });
    },
  });
  const reject = useMutation({
    mutationFn: () => rejectServiceDraft(item.id),
    onSuccess: () => void refresh(),
  });
  const busy = accept.isPending || reject.isPending;
  const blocker = acceptBlocker(department, data.openedBy);
  const failure = accept.error ?? reject.error;
  const badge = draftFilterLabel(item, data.filterEnabled);
  const confirmReject = () =>
    Alert.alert("Elveted a piszkozatot?", item.title, [
      { text: "Mégsem", style: "cancel" },
      { text: "Elvetem", style: "destructive", onPress: () => reject.mutate() },
    ]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.meta}>{draftMetaLine(item)}</Text>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <Text style={styles.problem}>{item.originalProblem}</Text>

      <Text style={styles.label}>Helyszín</Text>
      <View style={styles.chips}>
        {data.locations.map((location) => {
          const selected = location.id === department;
          return (
            <Pressable
              key={location.id}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              onPress={() => setDepartment(selected ? "" : location.id)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text
                style={[styles.chipLabel, selected && styles.chipLabelSelected]}
              >
                {location.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Jelentő szerzője</Text>
      <TextInput
        editable={!busy}
        maxLength={200}
        onChangeText={setAuthor}
        placeholder="Név (nem kötelező)"
        placeholderTextColor={tokens.textMuted}
        style={styles.input}
        value={author}
      />

      {blocker ? <Text style={styles.hint}>{blocker}</Text> : null}
      {failure ? (
        <Text style={styles.errorText}>
          {failure instanceof Error
            ? failure.message
            : "A döntés nem menthető."}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={`Elfogadom: ${item.title}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !!blocker }}
          disabled={busy || !!blocker}
          onPress={() => accept.mutate()}
          style={({ pressed }) => [
            styles.primary,
            (busy || blocker) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryText}>
            {accept.isPending ? "Mentés…" : "Elfogadom"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Elvetem: ${item.title}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={confirmReject}
          style={({ pressed }) => [
            styles.secondary,
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryText}>
            {reject.isPending ? "Mentés…" : "Elvetem"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { backgroundColor: t.background, flex: 1 },
    list: { gap: 12, padding: 16 },
    header: { gap: 10, paddingBottom: 4 },
    centered: { flex: 1, gap: 10, justifyContent: "center", padding: 24 },
    title: { color: t.textPrimary, fontSize: 22, fontWeight: "700" },
    hint: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 12,
      borderWidth: 1,
      gap: 6,
      padding: 14,
    },
    cardTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "600" },
    meta: { color: t.textMuted, fontSize: 12 },
    badge: {
      alignSelf: "flex-start",
      backgroundColor: t.warningSoft,
      borderRadius: 999,
      color: t.textPrimary,
      fontSize: 11,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    problem: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    errorCard: {
      alignItems: "flex-start",
      backgroundColor: t.dangerSoft,
      borderRadius: 12,
      gap: 10,
      padding: 14,
    },
    errorText: { color: t.danger, fontSize: 13, lineHeight: 18 },
    retry: {
      borderColor: t.danger,
      borderRadius: 9,
      borderWidth: 1,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    retryText: { color: t.danger, fontWeight: "600" },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.45 },
    label: { color: t.textSecondary, fontSize: 12, marginTop: 4 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipSelected: { backgroundColor: t.accent, borderColor: t.accent },
    chipLabel: { color: t.textSecondary, fontSize: 13 },
    chipLabelSelected: { color: t.textOnAccent, fontWeight: "600" },
    input: {
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      color: t.textPrimary,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    actions: { flexDirection: "row", gap: 10, marginTop: 6 },
    primary: {
      alignItems: "center",
      backgroundColor: t.accent,
      borderRadius: 10,
      flex: 1,
      paddingVertical: 11,
    },
    primaryText: { color: t.textOnAccent, fontSize: 15, fontWeight: "600" },
    secondary: {
      alignItems: "center",
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      flex: 1,
      paddingVertical: 11,
    },
    secondaryText: { color: t.textPrimary, fontSize: 15, fontWeight: "600" },
  });
}
