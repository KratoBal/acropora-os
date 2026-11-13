import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  clearMyAttendanceDay,
  getMyAttendanceSheet,
  markMyAttendanceDay,
} from "@/lib/api/attendance";
import {
  budapestToday,
  canMarkOwnDay,
  dayLabel,
  formatHours,
  hasAttendanceSheet,
  monthLabel,
  ownMark,
  rowNote,
  rowTimes,
  shiftMonth,
  type AttendanceSheetRow,
  type OwnMark,
} from "@/lib/attendance/presentation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * JELENLÉTI ÍVEM (os-jelenleti-iv, S3b; brief point 3): the employee's own month on the phone, and leave or a day off
 * marked in advance, from tomorrow on. A day the admin marked otherwise (sick, other times), today and the past are not
 * offered; the server checks the same rule again. Reached from Beállítások, like the web's user menu: it needs no right.
 */
export default function OwnAttendanceScreen() {
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const today = budapestToday(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled =
    status === "authenticated" && !!user && hasAttendanceSheet(user.role);
  const sheet = useQuery({
    queryKey: ["my-attendance", month],
    queryFn: () => getMyAttendanceSheet(month),
    enabled,
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await sheet.refetch();
    } catch (cause) {
      // the server's own sentence goes out: it names why (a day the admin marked meanwhile, a past day)
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const mark = (row: AttendanceSheetRow, kind: OwnMark) =>
    void run(() => markMyAttendanceDay(row.date, { kind }));

  const clear = (row: AttendanceSheetRow) =>
    // asked first: a removed mark silently turns the day back into a working day
    Alert.alert(
      "Törlöd a jelölésedet?",
      `${dayLabel(row)}: a nap ismét a munkarended szerint számít. A nap előtt újra jelölheted.`,
      [
        { text: "Mégse", style: "cancel" },
        {
          text: "Törlés",
          style: "destructive",
          onPress: () => void run(() => clearMyAttendanceDay(row.date)),
        },
      ],
    );

  const choose = (row: AttendanceSheetRow) => {
    const current = ownMark(row);
    Alert.alert(dayLabel(row), "Mit jelölsz erre a napra?", [
      ...(current !== "LEAVE"
        ? [{ text: "Szabadság (SZ)", onPress: () => mark(row, "LEAVE") }]
        : []),
      ...(current !== "DAY_OFF"
        ? [{ text: "Szabadnap", onPress: () => mark(row, "DAY_OFF") }]
        : []),
      ...(current
        ? [
            {
              text: "Jelölés törlése",
              style: "destructive" as const,
              onPress: () => clear(row),
            },
          ]
        : []),
      { text: "Mégse", style: "cancel" as const },
    ]);
  };

  if (!hasAttendanceSheet(user.role))
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.title}>Jelenléti ívem</Text>
          <Text style={styles.hint}>
            Ehhez a fiókhoz nem tartozik jelenléti ív: partner- és gépi fióknak
            nincs.
          </Text>
        </View>
      </SafeAreaView>
    );

  const data = sheet.data && sheet.data.month === month ? sheet.data : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={sheet.isRefetching}
            onRefresh={() => void sheet.refetch()}
          />
        }
      >
        <Text style={styles.title}>Jelenléti ívem</Text>
        <Text style={styles.hint}>
          Holnaptól előre jelölhetsz szabadságot vagy szabadnapot; minden mást
          az adminisztrátor rögzít.
        </Text>

        <View style={styles.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Előző hónap"
            onPress={() => setMonth(shiftMonth(month, -1))}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Következő hónap"
            onPress={() => setMonth(shiftMonth(month, 1))}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>›</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {sheet.isError ? (
          <Text style={styles.error}>
            {sheet.error instanceof Error
              ? sheet.error.message
              : "A jelenléti ív nem tölthető be."}
          </Text>
        ) : !data ? (
          <ActivityIndicator color={tokens.accent} />
        ) : (
          <View style={styles.card}>
            {data.rows.map((row) => {
              const editable = canMarkOwnDay(row, today);
              return (
                <Pressable
                  key={row.date}
                  accessibilityRole={editable ? "button" : undefined}
                  accessibilityLabel={`${dayLabel(row)} ${rowTimes(row)} ${rowNote(row)}`.trim()}
                  disabled={!editable || busy}
                  onPress={() => choose(row)}
                  style={({ pressed }) => [
                    styles.dayRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.dayLabel}>{dayLabel(row)}</Text>
                  <Text style={styles.dayTimes}>{rowTimes(row)}</Text>
                  <Text style={styles.dayHours}>
                    {row.kind === "WORK" ? formatHours(row.minutes) : ""}
                  </Text>
                  <Text style={styles.dayNote} numberOfLines={1}>
                    {rowNote(row)}
                    {editable ? "  ›" : ""}
                  </Text>
                </Pressable>
              );
            })}
            <Text style={styles.total}>
              Ledolgozott: {formatHours(data.totalMinutes)} óra · Betegség:{" "}
              {data.sickDays} nap · Szabadság: {data.leaveDays} nap
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { gap: 12, padding: 18, paddingBottom: 28 },
    title: { color: t.textPrimary, fontSize: 26, fontWeight: "900" },
    hint: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    monthRow: { alignItems: "center", flexDirection: "row", gap: 12 },
    monthButton: {
      alignItems: "center",
      borderColor: t.border,
      borderRadius: 12,
      borderWidth: 1,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
    monthButtonText: { color: t.textPrimary, fontSize: 20, fontWeight: "800" },
    monthLabel: {
      color: t.textPrimary,
      flex: 1,
      fontSize: 16,
      fontWeight: "800",
      textAlign: "center",
    },
    error: { color: t.danger, fontSize: 13 },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 18,
      borderWidth: 1,
      padding: 12,
    },
    dayRow: {
      alignItems: "center",
      borderBottomColor: t.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 8,
      paddingVertical: 8,
    },
    dayLabel: {
      color: t.textPrimary,
      fontSize: 13,
      fontWeight: "700",
      width: 78,
    },
    dayTimes: { color: t.textPrimary, fontSize: 13, width: 92 },
    dayHours: { color: t.textSecondary, fontSize: 13, width: 40 },
    dayNote: { color: t.textSecondary, flex: 1, fontSize: 12 },
    pressed: { opacity: 0.6 },
    total: {
      color: t.textPrimary,
      fontSize: 13,
      fontWeight: "700",
      marginTop: 10,
    },
  });
}
