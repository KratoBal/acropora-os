import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addWorksheetLine,
  getWorksheet,
  removeWorksheetLine,
} from "@/lib/api/worksheets";
import {
  buildWorksheetLinePayload,
  worksheetLineId,
} from "@/lib/worksheets/worksheet-line";
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
  /**
   * A TETEL-FELVITEL ALLAPOTA. Harom mezo, mert a szerelo harmat rogzit: mit
   * csinalt, mennyit, milyen egysegben. Az ARAT az iroda adja meg.
   */
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("óra");
  const [lineError, setLineError] = useState<string | null>(null);
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

  /**
   * A HOROK A KORAI VISSZATERESEK ELOTT ALLNAK, es ez nem stilus: a React
   * szabalya szerint minden renderelesben UGYANABBAN a sorrendben kell
   * lefutniuk. Egy `Redirect` utan elhelyezve az elso jogosultsag-valtasnal
   * borulna a sorrend, es a hiba nem itt jelenne meg.
   */
  const queryClient = useQueryClient();

  /**
   * TETEL HOZZAADASA -- SOR-SZINTU MUVELET, NEM TELJES CSERE.
   *
   * Egy lapnak TOBB felelose lehet, es a teljes tartalmat cserelo mentes a
   * masik szerelo sorait torolne. A szerver ezt a vegpontot EPP A MOBILNAK
   * keszitette (a kod megjegyzese ki is mondja), es 2026-09-03-ig NEM hivta
   * senki: a kepesseg megvolt, a hivo hianyzott.
   *
   * A DONTES a `lib/worksheets/worksheet-line.ts`-ben all, mert ott MERHETO.
   */
  const addLine = useMutation({
    mutationFn: async () => {
      const built = buildWorksheetLinePayload(
        { description, quantity, unit },
        worksheetLineId({ now: Date.now(), random: Math.random() }),
      );
      if (!built.ok) throw new Error(built.message);
      return addWorksheetLine(id, built.payload);
    },
    onSuccess: async () => {
      setDescription("");
      setQuantity("");
      setLineError(null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
    },
    onError: (cause) =>
      setLineError(
        cause instanceof Error ? cause.message : "A tétel nem menthető.",
      ),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => removeWorksheetLine(id, lineId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
    },
    onError: (cause) =>
      setLineError(
        cause instanceof Error ? cause.message : "A tétel nem törölhető.",
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

            {/*
              A FELVITEL CSAK PISZKOZATON, ES CSAK IRASI JOGGAL.
              A szerver ugyanezt koveteli (a sor-vegpontok piszkozat-verziot
              kernek), es ha a gomb ott allna egy lezart lapon, azt igerne,
              hogy megoldodik -- holott a keres ugyanazt a hibat kapna.
            */}
            {capabilities.worksheetsManage && current.status === "DRAFT" ? (
              <View style={styles.card}>
                <Text style={styles.label}>Mit csináltál</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Például: szivattyú csere"
                  placeholderTextColor="#5b7d8f"
                  style={styles.input}
                />
                <View style={styles.lineRow}>
                  <View style={styles.lineCell}>
                    <Text style={styles.label}>Mennyi</Text>
                    <TextInput
                      value={quantity}
                      onChangeText={setQuantity}
                      placeholder="1,5"
                      placeholderTextColor="#5b7d8f"
                      keyboardType="decimal-pad"
                      style={styles.input}
                    />
                  </View>
                  <View style={styles.lineCell}>
                    <Text style={styles.label}>Egység</Text>
                    <TextInput
                      value={unit}
                      onChangeText={setUnit}
                      placeholder="óra"
                      placeholderTextColor="#5b7d8f"
                      style={styles.input}
                    />
                  </View>
                </View>
                {/*
                  AZ AR NINCS ITT, ES EZ DONTES: az arat az iroda adja meg
                  (Balazs, 2026-09-02). Ar nelkuli tetellel a lap nem zarhato
                  le, tehat a hiany nem marad eszrevetlen.
                */}
                <Text style={styles.muted}>
                  Az árat az irodából teszik rá; enélkül a lap nem zárható le.
                </Text>
                {lineError ? (
                  <Text style={styles.lineError}>{lineError}</Text>
                ) : null}
                <Pressable
                  disabled={addLine.isPending}
                  onPress={() => addLine.mutate()}
                  style={[
                    styles.addLineButton,
                    addLine.isPending && styles.disabled,
                  ]}
                >
                  <Text style={styles.addLineText}>
                    {addLine.isPending ? "Mentés…" : "Tétel hozzáadása"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
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
                      Partner azonosítója: {line.inventoryNumber}
                    </Text>
                  ) : null}
                  <Text style={styles.lineSummary}>
                    {worksheetLineSummary(line, current.currency)}
                  </Text>
                  {/*
                    A TORLES CSAK PISZKOZATON. Egy lezart lapon a gomb olyat
                    igerne, amit a szerver elutasit.
                  */}
                  {capabilities.worksheetsManage &&
                  current.status === "DRAFT" ? (
                    <Pressable
                      disabled={removeLine.isPending}
                      onPress={() => removeLine.mutate(line.id)}
                    >
                      <Text style={styles.removeLine}>Tétel törlése</Text>
                    </Pressable>
                  ) : null}
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
  input: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f4fbff",
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lineRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  lineCell: { flex: 1 },
  lineError: { color: "#ffb4ab", fontSize: 12, marginTop: 8 },
  addLineButton: {
    backgroundColor: "#177b74",
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
  },
  addLineText: { color: "#fff", fontWeight: "900", textAlign: "center" },
  removeLine: {
    color: "#ffb4ab",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
});
