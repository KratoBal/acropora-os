import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AquariumAvatar } from "@/components/aquariums/AquariumAvatar";
import { AquariumBadge } from "@/components/aquariums/AquariumBadge";
import { ConnectivityBanner } from "@/components/offline/ConnectivityBanner";
import {
  addAquariumEquipment,
  deleteAquariumMeasurement,
  getAquarium,
  listAquariumMeasurements,
  removeAquariumEquipment,
  type CreateAquariumEquipmentInput,
} from "@/lib/api/aquariums";
import {
  aquariumEquipmentProblem,
  emptyAquariumEquipmentForm,
  normalizeDecimalText,
  type AquariumEquipmentForm,
} from "@/lib/aquariums/aquarium-create";
import {
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_OPTIONS,
  OWNERSHIP_LABEL,
  WATER_BODY_LABEL,
} from "@/lib/aquariums/aquarium-labels";
import { aquariumMeasurementParameter } from "@/lib/aquariums/aquarium-measurement-create";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useIsOnline } from "@/lib/offline/connectivity";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * AKVÁRIUM ADATLAP.
 *
 * A TÖRZSADAT (név, méretek, tulajdon) ITT NEM SZERKESZTHETŐ -- a brief
 * mobil-ága kimondottan a FELVITELT kérte, az adatlap-szerkesztés a web
 * oldalon van. Ez tudatos hatókör-döntés, nem hiányzó munka (acrobot
 * kérése, 2026-09-24 14:13, a `new.tsx` mellé kerülő lista+adatlap körben).
 *
 * AZ ESZKÖZÖK LISTÁJA ÉS FELVITELE VISZONT MOBILRA IS KELL, ezért az
 * egyetlen ÍRÓ művelet ezen a lapon az eszközsor hozzáadása/törlése -- a
 * csatornaszám-ellenőrzés ugyanazt a `aquariumEquipmentProblem`-et hívja,
 * mint a felviteli képernyő, hogy a két hely ne mondhasson mást.
 *
 * A "VÍZÉRTÉKEK" SZEKCIÓ (murena #1055-ös API-ja) a brief 3. döntése szerint
 * a telefonon CSAK LISTA -- a webes idősoros grafikon ide nem kerül. A
 * felvitel külön képernyőn (`[id]/measurement.tsx`) történik, ugyanazzal az
 * offline sorba-állítási mintával, mint az akvárium saját felvitele.
 *
 * A KARBANTARTÓK (brief 8. döntés) CSAK MEGJELENÍTÉS ebben a körben -- a
 * választás webes.
 *
 * A JELVÉNYEK, A KARBANTARTÓ-AVATAROK ÉS A VÍZÉRTÉK-CSEMPÉK a Figma-terv
 * (`exchange/figma-akvariumok-make-2`) mobil szekciójából jönnek
 * szerkezetileg.
 *
 * A SZÍNEK 2026-09-24-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK (Balázs
 * döntése, emlék 1816): ez a lap az akvárium-képernyők egyike, tehát
 * világos és sötét módban is helyesen jelenik meg.
 */
export default function AquariumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<AquariumEquipmentForm>(
    emptyAquariumEquipmentForm(),
  );
  const [equipmentError, setEquipmentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removingMeasurementId, setRemovingMeasurementId] = useState<
    string | null
  >(null);

  const aquarium = useQuery({
    queryKey: ["aquarium", id],
    queryFn: () => getAquarium(id),
    enabled: Boolean(
      id && capabilities?.aquariumsView && status === "authenticated",
    ),
  });

  const measurements = useQuery({
    queryKey: ["aquarium-measurements", id],
    queryFn: () => listAquariumMeasurements(id),
    enabled: Boolean(
      id && capabilities?.aquariumsView && status === "authenticated",
    ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.aquariumsView) return <Redirect href="/" />;

  const data = aquarium.data;
  /** A LEGUTÓBBI ELÖL: a szerver nem ígér sorrendet, a képernyő a
   * `measuredAt` szerint csökkenőbe rendez, hogy a "legutóbbi mérés" fejléc
   * és a lista első sora sose mondhasson mást. */
  const occasions = [...(measurements.data?.occasions ?? [])].sort((a, b) =>
    b.measuredAt.localeCompare(a.measuredAt),
  );
  const latestOccasion = occasions[0] ?? null;
  const olderOccasions = occasions.slice(1);

  function removeMeasurement(occasionId: string) {
    if (!data) return;
    Alert.alert(
      "Törlöd ezt a mérési alkalmat?",
      "A mérés minden paramétere véglegesen törlődik.",
      [
        { text: "Mégsem", style: "cancel" },
        {
          text: "Törlés",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setRemovingMeasurementId(occasionId);
              try {
                await deleteAquariumMeasurement(data.id, occasionId);
                await queryClient.invalidateQueries({
                  queryKey: ["aquarium-measurements", id],
                });
              } catch (cause) {
                Alert.alert(
                  "Nem sikerült törölni",
                  cause instanceof Error
                    ? cause.message
                    : "A mérés törlése nem sikerült.",
                );
              } finally {
                setRemovingMeasurementId(null);
              }
            })();
          },
        },
      ],
    );
  }

  async function addEquipment() {
    if (!data) return;
    const channelCount = normalizeDecimalText(draft.channelCount);
    if (draft.channelCount.trim() !== "" && channelCount === null) {
      setEquipmentError("A csatornaszám csak szám lehet.");
      return;
    }
    const problem = aquariumEquipmentProblem({
      kind: draft.kind,
      channelCount,
    });
    if (problem === "CHANNEL_COUNT_REQUIRED") {
      setEquipmentError("A nyomelem-adagoló csatornaszáma kötelező.");
      return;
    }
    if (problem === "CHANNEL_COUNT_NOT_ALLOWED") {
      setEquipmentError("Csatornaszám csak a nyomelem-adagolónál adható meg.");
      return;
    }
    setEquipmentError(null);
    setSaving(true);
    try {
      const input: CreateAquariumEquipmentInput = {
        kind: draft.kind,
        manufacturer: draft.manufacturer.trim() || undefined,
        model: draft.model.trim() || undefined,
        quantity: normalizeDecimalText(draft.quantity) ?? undefined,
        channelCount: channelCount ?? undefined,
        notes: draft.notes.trim() || undefined,
      };
      await addAquariumEquipment(data.id, input);
      setDraft(emptyAquariumEquipmentForm());
      await queryClient.invalidateQueries({ queryKey: ["aquarium", id] });
    } catch (cause) {
      setEquipmentError(
        cause instanceof Error ? cause.message : "Az eszköz nem menthető el.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeEquipment(equipmentId: string) {
    if (!data) return;
    setRemovingId(equipmentId);
    try {
      await removeAquariumEquipment(data.id, equipmentId);
      await queryClient.invalidateQueries({ queryKey: ["aquarium", id] });
    } catch {
      // A HIBA A LISTÁN LÁTSZIK, KÜLÖN ÜZENET NÉLKÜL: a sor egyszerűen
      // megmarad, és a felhasználó újra megpróbálhatja -- egy eltűnt-majd-
      // visszatért sor rosszabb élmény lenne, mint egy csendes újrapróbálás.
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {!online ? <ConnectivityBanner /> : null}

        <Text style={styles.eyebrow}>{data?.aquariumNumber ?? "AKVÁRIUM"}</Text>
        <Text style={styles.title}>{data?.name ?? "Akvárium"}</Text>
        {data ? (
          <View style={styles.badgeRow}>
            <AquariumBadge
              tone={data.ownershipType === "OWN" ? "teal" : "grey"}
            >
              {data.ownershipType === "OWN" ? "Saját" : "Ügyfél"}
            </AquariumBadge>
            <AquariumBadge>
              {WATER_BODY_LABEL[data.waterBodyType]}
            </AquariumBadge>
            {data.waterType ? (
              <AquariumBadge tone="teal">
                {data.waterType === "TENGERI" ? "Tengeri" : "Édesvízi"}
              </AquariumBadge>
            ) : null}
          </View>
        ) : null}

        {aquarium.isPending ? (
          <ActivityIndicator color={tokens.accent} />
        ) : null}
        {aquarium.isError ? (
          <Text style={styles.error}>
            {aquarium.error instanceof Error
              ? aquarium.error.message
              : "Az akvárium nem tölthető be."}
          </Text>
        ) : null}

        {data ? (
          <View style={styles.card}>
            <Row
              styles={styles}
              label="Tulajdon"
              value={
                data.ownershipType === "CUSTOMER" && data.customerName
                  ? data.customerName
                  : OWNERSHIP_LABEL[data.ownershipType]
              }
            />
            {data.lengthCm !== undefined &&
            data.widthCm !== undefined &&
            data.heightCm !== undefined ? (
              <Row
                styles={styles}
                label="Méretek"
                value={`${data.lengthCm} × ${data.widthCm} × ${data.heightCm} cm`}
              />
            ) : null}
            {data.systemVolumeLiters !== undefined ? (
              <Row
                styles={styles}
                label="Térfogat"
                value={`${data.systemVolumeLiters} l${
                  data.systemVolumeIsManual ? " (kézi)" : ""
                }`}
              />
            ) : null}
            {data.startedAt ? (
              <Row styles={styles} label="Indítva" value={data.startedAt} />
            ) : null}
            {data.notes ? (
              <Row styles={styles} label="Megjegyzés" value={data.notes} />
            ) : null}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Karbantartók</Text>
              {data.maintainers.length > 0 ? (
                <View style={styles.avatarRow}>
                  {data.maintainers.map((m) => (
                    <AquariumAvatar
                      key={m.userId}
                      userId={m.userId}
                      displayName={m.displayName}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.rowValue}>Nincs megadva</Text>
              )}
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Eszközök</Text>
        {data?.equipment.length === 0 ? (
          <Text style={styles.empty}>Nincs felvéve eszköz.</Text>
        ) : null}
        {data?.equipment.map((row) => (
          <View key={row.id} style={styles.equipmentRow}>
            <View style={styles.equipmentInfo}>
              <Text style={styles.equipmentLabel}>
                {EQUIPMENT_KIND_LABEL[row.kind]}
                {row.quantity > 1 ? ` × ${row.quantity}` : ""}
              </Text>
              {row.manufacturer || row.model ? (
                <Text style={styles.equipmentMeta}>
                  {[row.manufacturer, row.model].filter(Boolean).join(" ")}
                </Text>
              ) : null}
              {row.channelCount ? (
                <Text style={styles.equipmentMeta}>
                  {row.channelCount} csatorna
                </Text>
              ) : null}
              {row.notes ? (
                <Text style={styles.equipmentMeta}>{row.notes}</Text>
              ) : null}
            </View>
            {capabilities.aquariumsManage ? (
              <Pressable
                disabled={removingId === row.id}
                onPress={() => void removeEquipment(row.id)}
              >
                <Text style={styles.removeText}>
                  {removingId === row.id ? "Törlés…" : "Törlés"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        {capabilities.aquariumsManage && data ? (
          <View style={styles.addPanel}>
            <View style={styles.chipRow}>
              {EQUIPMENT_KIND_OPTIONS.map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() =>
                    setDraft((current) => ({ ...current, kind: value }))
                  }
                  style={[
                    styles.chip,
                    draft.kind === value && styles.chipSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      draft.kind === value && styles.chipTextSelected,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.dimensionRow}>
              <TextInput
                value={draft.manufacturer}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, manufacturer: value }))
                }
                placeholder="Gyártó"
                placeholderTextColor={tokens.textMuted}
                style={[styles.input, styles.dimensionInput]}
              />
              <TextInput
                value={draft.model}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, model: value }))
                }
                placeholder="Típus"
                placeholderTextColor={tokens.textMuted}
                style={[styles.input, styles.dimensionInput]}
              />
              <TextInput
                value={draft.quantity}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, quantity: value }))
                }
                placeholder="Db"
                placeholderTextColor={tokens.textMuted}
                keyboardType="number-pad"
                style={[styles.input, styles.dimensionInput]}
              />
            </View>
            {draft.kind === "NYOMELEM_ADAGOLO" ? (
              <TextInput
                value={draft.channelCount}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, channelCount: value }))
                }
                placeholder="Csatornaszám"
                placeholderTextColor={tokens.textMuted}
                keyboardType="number-pad"
                style={styles.input}
              />
            ) : null}
            {equipmentError ? (
              <Text style={styles.error}>{equipmentError}</Text>
            ) : null}
            <Pressable
              disabled={saving}
              onPress={() => void addEquipment()}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
                saving && styles.disabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {saving ? "Mentés…" : "Eszköz hozzáadása"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Vízértékek</Text>
          {capabilities.aquariumsManage && data ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/aquariums/[id]/measurement",
                  params: { id: data.id },
                })
              }
            >
              <Text style={styles.linkText}>Új mérés</Text>
            </Pressable>
          ) : null}
        </View>

        {measurements.isPending ? (
          <ActivityIndicator color={tokens.accent} />
        ) : null}
        {measurements.isError ? (
          <Text style={styles.error}>A vízértékek nem tölthetők be.</Text>
        ) : null}
        {!measurements.isPending && !measurements.isError && !latestOccasion ? (
          <Text style={styles.empty}>Még nincs felvéve vízmérés.</Text>
        ) : null}

        {latestOccasion ? (
          <View style={styles.card}>
            <Text style={styles.latestMeasuredAt}>
              Legutóbbi mérés: {latestOccasion.measuredAt}
            </Text>
            <View style={styles.paramGrid}>
              {latestOccasion.values.map((value) => {
                const param = aquariumMeasurementParameter(value.parameterCode);
                return (
                  <View key={value.parameterCode} style={styles.paramTile}>
                    <Text style={styles.paramTileLabel}>{param.label}</Text>
                    <Text style={styles.paramTileValue}>{value.value}</Text>
                    <Text style={styles.paramTileUnit}>{param.unit}</Text>
                  </View>
                );
              })}
            </View>
            {latestOccasion.notes ? (
              <Row
                styles={styles}
                label="Megjegyzés"
                value={latestOccasion.notes}
              />
            ) : null}
          </View>
        ) : null}

        {olderOccasions.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Korábbi mérések</Text>
            {olderOccasions.map((occasion) => (
              <View key={occasion.id} style={styles.equipmentRow}>
                <View style={styles.equipmentInfo}>
                  <Text style={styles.equipmentLabel}>
                    {occasion.measuredAt}
                  </Text>
                  <Text style={styles.equipmentMeta}>
                    {occasion.values
                      .map((value) => {
                        const param = aquariumMeasurementParameter(
                          value.parameterCode,
                        );
                        return `${param.label}: ${value.value} ${param.unit}`;
                      })
                      .join(" · ")}
                  </Text>
                </View>
                {capabilities.aquariumsManage ? (
                  <Pressable
                    disabled={removingMeasurementId === occasion.id}
                    onPress={() => removeMeasurement(occasion.id)}
                  >
                    <Text style={styles.removeText}>
                      {removingMeasurementId === occasion.id
                        ? "Törlés…"
                        : "Törlés"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 8 },
    eyebrow: {
      color: t.accent,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.4,
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "900" },
    badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    avatarRow: { flexDirection: "row", gap: 6, marginTop: 2 },
    latestMeasuredAt: { color: t.textSecondary, fontSize: 12 },
    paramGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },
    paramTile: {
      width: "31%",
      backgroundColor: t.background,
      borderRadius: 10,
      padding: 8,
    },
    paramTileLabel: { color: t.textSecondary, fontSize: 10, fontWeight: "700" },
    paramTileValue: {
      color: t.textPrimary,
      fontSize: 14,
      fontWeight: "800",
      marginTop: 2,
    },
    paramTileUnit: { color: t.textSecondary, fontSize: 10 },
    card: {
      marginTop: 12,
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
      gap: 10,
    },
    row: { gap: 2 },
    rowLabel: {
      color: t.textSecondary,
      fontSize: 11,
      textTransform: "uppercase",
    },
    rowValue: { color: t.textPrimary, fontSize: 15, fontWeight: "700" },
    sectionTitle: {
      color: t.textPrimary,
      fontSize: 16,
      fontWeight: "800",
      marginTop: 18,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    linkText: {
      color: t.accent,
      fontSize: 13,
      fontWeight: "700",
    },
    empty: { color: t.textSecondary },
    equipmentRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
      marginTop: 6,
    },
    equipmentInfo: { flexShrink: 1, gap: 2 },
    equipmentLabel: { color: t.textPrimary, fontWeight: "700" },
    equipmentMeta: { color: t.textSecondary, fontSize: 12 },
    removeText: { color: t.danger, fontWeight: "700" },
    addPanel: { marginTop: 12, gap: 8 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipSelected: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { color: t.textSecondary, fontSize: 12, fontWeight: "700" },
    chipTextSelected: { color: t.textOnAccent },
    dimensionRow: { flexDirection: "row", gap: 8 },
    dimensionInput: { flex: 1 },
    input: {
      color: t.textPrimary,
      backgroundColor: t.background,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    secondaryButton: {
      borderRadius: 10,
      backgroundColor: t.accent,
      borderWidth: 1,
      borderColor: t.accentPressed,
      paddingHorizontal: 14,
      paddingVertical: 11,
      alignItems: "center",
    },
    buttonText: { color: t.textOnAccent, fontWeight: "800" },
    pressed: { opacity: 0.75 },
    disabled: { opacity: 0.5 },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
  });
}
