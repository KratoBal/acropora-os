import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getWorksheet } from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  formatWorksheetAmount,
  formatWorksheetDate,
  worksheetAssigneeLine,
  worksheetDetailRows,
  worksheetLabelOrDraft,
  worksheetLineSummary,
  worksheetStatusLabel,
} from "@/lib/worksheets/worksheet-presentation";

/**
 * MUNKALAP A HELYSZÍNEN, OLVASÁSRA.
 *
 * Nincs rajta szerkesztés, és ez szándékos szűkítés, nem hiányosság: a szerver
 * ugyan `service.manage` jogot ad a szerviz szerepkörnek, de egy félig megírt
 * lap a telefonon olyan állapotot hozna létre, amit csak a webes felület tud
 * befejezni (lezárás, aláíratás, folytatás).
 *
 * AMI A LAP MAI ÁLLAPOTA, az a `currentVersion`. A korábbi változatok
 * változatlanok, és külön szakaszban látszanak: aki a kezében tartott papírral
 * érkezik, itt tudja eldönteni, hogy azóta átírták-e a lapot.
 */
export default function WorksheetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const worksheet = useQuery({
    queryKey: ["worksheet", id],
    queryFn: () => getWorksheet(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsView) return <Redirect href="/" />;

  const data = worksheet.data;
  const current = data?.currentVersion;
  const rows = data ? worksheetDetailRows(data) : [];
  const continuesFrom = data?.continues ?? null;
  const olderVersions = data?.versions.filter(
    (version) => version.version !== current?.version,
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>MUNKALAP</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {worksheetLabelOrDraft(current?.label ?? null)}
          </Text>
          {current ? (
            <View style={styles.statusChip}>
              <Text style={styles.statusText}>
                {worksheetStatusLabel[current.status]}
              </Text>
            </View>
          ) : null}
        </View>

        {worksheet.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

        {worksheet.isError ? (
          <Text style={styles.error}>
            {worksheet.error instanceof Error
              ? worksheet.error.message
              : "A munkalap nem tölthető be."}
          </Text>
        ) : null}

        {data && current ? (
          <>
            <Text style={styles.subject}>{current.subject}</Text>

            <View style={styles.card}>
              {rows.map((row) => (
                <View key={row.label} style={styles.row}>
                  <Text style={styles.label}>{row.label}</Text>
                  <Text style={styles.value}>{row.value}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Felelősök</Text>
            <View style={styles.card}>
              <Text style={styles.assignees}>
                {worksheetAssigneeLine(
                  data.assignees.map((assignee) => assignee.name),
                )}
              </Text>
            </View>

            {current.description ? (
              <>
                <Text style={styles.sectionTitle}>Leírás</Text>
                <View style={styles.card}>
                  <Text style={styles.value}>{current.description}</Text>
                </View>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>
              Tételek ({current.lines.length})
            </Text>
            {current.lines.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.muted}>Ezen a lapon még nincs tétel.</Text>
              </View>
            ) : (
              current.lines.map((line) => (
                <View key={line.id} style={styles.card}>
                  <Text style={styles.lineTitle}>{line.description}</Text>
                  {line.detail ? (
                    <Text style={styles.muted}>{line.detail}</Text>
                  ) : null}
                  {line.assetNumber ? (
                    <Text style={styles.muted}>{line.assetNumber}</Text>
                  ) : null}
                  {/*
                    AZ UGYFEL SAJAT KODJA, csak ha van, es FELIRATTAL. A felette
                    allo eszkozszam a MIENK, ez pedig az ugyfele: ket csupasz kod
                    egymas alatt pont azt a keveredest hozna, ami ellen a mezo
                    kulon nevet kapott.
                  */}
                  {line.inventoryNumber ? (
                    <Text style={styles.muted}>
                      Leltári szám: {line.inventoryNumber}
                    </Text>
                  ) : null}
                  <Text style={styles.lineSummary}>
                    {worksheetLineSummary(line, current.currency)}
                  </Text>
                </View>
              ))
            )}

            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>Nettó</Text>
                <Text style={styles.value}>
                  {formatWorksheetAmount(current.netAmount, current.currency)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Áfa</Text>
                <Text style={styles.value}>
                  {formatWorksheetAmount(current.vatAmount, current.currency)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Bruttó</Text>
                <Text style={styles.total}>
                  {formatWorksheetAmount(current.grossAmount, current.currency)}
                </Text>
              </View>
            </View>

            {current.signature ? (
              <>
                <Text style={styles.sectionTitle}>Aláírás</Text>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.label}>Aláíró</Text>
                    <Text style={styles.value}>
                      {current.signature.signerName}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Döntés</Text>
                    <Text style={styles.value}>
                      {current.signature.decision === "ACCEPTED"
                        ? "Elfogadva"
                        : "Elutasítva"}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Dátum</Text>
                    <Text style={styles.value}>
                      {formatWorksheetDate(current.signature.signedAt)}
                    </Text>
                  </View>
                  {current.signature.note ? (
                    <Text style={styles.muted}>{current.signature.note}</Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {/*
              A LÁNC MINDKÉT IRÁNYA. Egy aláírt lap végleges, a munka
              folytatása új lap -- aki a régit nyitja meg, ugyanúgy tudni
              akarja, hol folytatódott, mint fordítva.
            */}
            {continuesFrom || data.continuedBy.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Folytatás</Text>
                {continuesFrom ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/worksheets/[id]",
                        params: { id: continuesFrom.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.card,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.label}>Ennek a folytatása</Text>
                    <Text style={styles.value}>
                      {worksheetLabelOrDraft(continuesFrom.number)}
                    </Text>
                  </Pressable>
                ) : null}
                {data.continuedBy.map((link) => (
                  <Pressable
                    key={link.id}
                    onPress={() =>
                      router.push({
                        pathname: "/worksheets/[id]",
                        params: { id: link.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.card,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.label}>Itt folytatódott</Text>
                    <Text style={styles.value}>
                      {worksheetLabelOrDraft(link.number)}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {olderVersions && olderVersions.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Korábbi változatok</Text>
                {olderVersions.map((version) => (
                  <View key={version.id} style={styles.card}>
                    <View style={styles.row}>
                      <Text style={styles.label}>
                        {worksheetLabelOrDraft(version.label)}
                      </Text>
                      <Text style={styles.value}>
                        {worksheetStatusLabel[version.status]}
                      </Text>
                    </View>
                    {version.changeReason ? (
                      <Text style={styles.muted}>{version.changeReason}</Text>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 12 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  title: { color: "#f4fbff", flex: 1, fontSize: 24, fontWeight: "900" },
  statusChip: {
    backgroundColor: "#123f3b",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: { color: "#6de0ce", fontSize: 11, fontWeight: "800" },
  subject: { color: "#d9edf7", fontSize: 16, fontWeight: "700" },
  sectionTitle: {
    color: "#f4fbff",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  card: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 16,
    gap: 8,
    padding: 14,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  label: { color: "#789cad", fontSize: 12, fontWeight: "700" },
  value: { color: "#f4fbff", flex: 1, fontSize: 14, textAlign: "right" },
  total: {
    color: "#6de0ce",
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "right",
  },
  assignees: { color: "#f4fbff", fontSize: 14 },
  lineTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  lineSummary: { color: "#6de0ce", fontSize: 13, fontWeight: "700" },
  muted: { color: "#789cad", fontSize: 12 },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  pressed: { opacity: 0.75 },
});
