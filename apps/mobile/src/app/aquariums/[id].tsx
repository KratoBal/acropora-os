import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
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
  addAquariumEquipment,
  getAquarium,
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
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

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
 */
export default function AquariumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<AquariumEquipmentForm>(
    emptyAquariumEquipmentForm(),
  );
  const [equipmentError, setEquipmentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const aquarium = useQuery({
    queryKey: ["aquarium", id],
    queryFn: () => getAquarium(id),
    enabled: Boolean(
      id && capabilities?.aquariumsView && status === "authenticated",
    ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.aquariumsView) return <Redirect href="/" />;

  const data = aquarium.data;

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
        <Text style={styles.eyebrow}>{data?.aquariumNumber ?? "AKVÁRIUM"}</Text>
        <Text style={styles.title}>{data?.name ?? "Akvárium"}</Text>

        {aquarium.isPending ? <ActivityIndicator color="#52d6c7" /> : null}
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
              label="Tulajdon"
              value={
                data.ownershipType === "CUSTOMER" && data.customerName
                  ? data.customerName
                  : OWNERSHIP_LABEL[data.ownershipType]
              }
            />
            <Row label="Víztest" value={WATER_BODY_LABEL[data.waterBodyType]} />
            {data.lengthCm !== undefined &&
            data.widthCm !== undefined &&
            data.heightCm !== undefined ? (
              <Row
                label="Méretek"
                value={`${data.lengthCm} × ${data.widthCm} × ${data.heightCm} cm`}
              />
            ) : null}
            {data.systemVolumeLiters !== undefined ? (
              <Row
                label="Térfogat"
                value={`${data.systemVolumeLiters} l${
                  data.systemVolumeIsManual ? " (kézi)" : ""
                }`}
              />
            ) : null}
            {data.waterType ? (
              <Row
                label="Víztípus"
                value={data.waterType === "TENGERI" ? "Tengeri" : "Édesvízi"}
              />
            ) : null}
            {data.startedAt ? (
              <Row label="Indítva" value={data.startedAt} />
            ) : null}
            {data.notes ? <Row label="Megjegyzés" value={data.notes} /> : null}
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
                placeholderTextColor="#668798"
                style={[styles.input, styles.dimensionInput]}
              />
              <TextInput
                value={draft.model}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, model: value }))
                }
                placeholder="Típus"
                placeholderTextColor="#668798"
                style={[styles.input, styles.dimensionInput]}
              />
              <TextInput
                value={draft.quantity}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, quantity: value }))
                }
                placeholder="Db"
                placeholderTextColor="#668798"
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
                placeholderTextColor="#668798"
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
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 8 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  card: {
    marginTop: 12,
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  row: { gap: 2 },
  rowLabel: { color: "#789cad", fontSize: 11, textTransform: "uppercase" },
  rowValue: { color: "#f4fbff", fontSize: 15, fontWeight: "700" },
  sectionTitle: {
    color: "#f4fbff",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 18,
  },
  empty: { color: "#91afbe" },
  equipmentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
  },
  equipmentInfo: { flexShrink: 1, gap: 2 },
  equipmentLabel: { color: "#f4fbff", fontWeight: "700" },
  equipmentMeta: { color: "#789cad", fontSize: 12 },
  removeText: { color: "#fca5a5", fontWeight: "700" },
  addPanel: { marginTop: 12, gap: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#28536a",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: "#177b74", borderColor: "#177b74" },
  chipText: { color: "#91afbe", fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: "#fff" },
  dimensionRow: { flexDirection: "row", gap: 8 },
  dimensionInput: { flex: 1 },
  input: {
    color: "#f4fbff",
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  secondaryButton: {
    borderRadius: 10,
    backgroundColor: "#16495e",
    borderWidth: 1,
    borderColor: "#2b657d",
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "800" },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
});
