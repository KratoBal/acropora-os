import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api/client";
import {
  createAquarium,
  searchSelectableAquariumCustomers,
} from "@/lib/api/aquariums";
import {
  buildAquariumCreatePayload,
  emptyAquariumCreateForm,
  emptyAquariumEquipmentForm,
  normalizeDecimalText,
  resolveAquariumVolume,
  type AquariumCreateField,
  type AquariumCreateForm,
  type AquariumEquipmentKind,
  type AquariumOwnershipType,
  type WaterBodyType,
} from "@/lib/aquariums/aquarium-create";
import {
  EQUIPMENT_KIND_OPTIONS,
  OWNERSHIP_LABEL,
  WATER_BODY_LABEL,
} from "@/lib/aquariums/aquarium-labels";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { enqueueAquariumCreate } from "@/lib/offline/queue-store";
import { saveOrQueue } from "@/lib/offline/save-or-queue";
import { aquariumOperationId } from "@/lib/offline/sync-queue";

/**
 * ÚJ AKVÁRIUM (VAGY TÓ) A HELYSZÍNRŐL.
 *
 * Balázs 2026-09-24 13:01-i döntése bővítette a telefonra: "az akvarium
 * felvitele, benne az ugyfel helyben felvetele (nev, cim, telefon, e-mail),
 * a meretek es a liter, az eszkozok". A web-oldali kör ugyanezt a
 * `POST /aquariums` végpontot hívja -- ez a képernyő a mobil felvitel,
 * NEM lista/részlet/szerkesztés: a brief szó szerint "felvitelt" kért.
 *
 * === MI SZŰKEBB, MINT A WEBEN, ÉS MIÉRT ===
 *
 * 1. MEGLÉVŐ ÜGYFÉL KERESÉSE 2026-09-24-TŐL MEGY (acrobot 2. tétele): a
 *    `GET /aquariums/customers` -- `aquariums.view` alatt, nem a `/customers`
 *    (amit a `SERVICE` szerepkör nem érne el). A döntés a
 *    `lib/aquariums/aquarium-create.ts`-ben áll (`customerMode`), itt csak a
 *    választó jelenik meg.
 * 2. VÍZTÍPUS, KEZDÉS DÁTUMA, MEGJEGYZÉS NINCS AZ ŰRLAPON: a brief mobil
 *    kiegészítése ("meretek es a liter, az eszkozok") ezeket nem nevezte meg.
 *
 * === OFFLINE SORBAÁLLÍTÁS (2026-09-24, acrobot kérése) ===
 *
 * Ugyanaz a `saveOrQueue`+`queue-store` minta, mint az eszköz, a munkalap és
 * a hibajegy felvitelénél: térerő nélkül a felvitel a helyi sorba kerül, és
 * amint van hálózat, a `useQueueDrain` magától felküldi. Az ÚJ ügyfél
 * (`newCustomer`) EGY hívásban utazik az akváriummal -- nem külön sorba
 * tett lépésként --, mert a szerver `POST /aquariums` egyetlen kérésben
 * kezeli mindkettőt: két sorba tett lépés azt kockáztatná, hogy az akvárium
 * sora a még fel nem ment ügyfélre hivatkozna. A kétszeri küldés ellen a
 * `clientOperationId` véd (lásd `aquariumOperationId` a `sync-queue.ts`-ben
 * és a szerver oldali kettős védelmet az `aquariums.repository.ts`-ben).
 *
 * === A DÖNTÉS A `lib/aquariums/aquarium-create.ts`-BEN VAN ===
 *
 * Mert ott MÉRHETŐ: ebben a fájlban nincs, ami tesztelné.
 */
export default function NewAquariumScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const [form, setForm] = useState<AquariumCreateForm>(emptyAquariumCreateForm);
  const [error, setError] = useState<{
    field: AquariumCreateField | null;
    message: string;
  } | null>(null);
  /**
   * A SORBA TETT FELVITEL ÜZENETE, KÜLÖN AZ ERRORTÓL. Nem hiba: a felvitel
   * megtörtént, csak még a telefonon vár -- ugyanaz a megkülönböztetés, mint
   * a munkalap és a hibajegy felvitelén.
   */
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (
      payload: Extract<
        ReturnType<typeof buildAquariumCreatePayload>,
        { ok: true }
      >["payload"],
    ) => {
      const startedAt = new Date().toISOString();
      const operationId = aquariumOperationId({
        ownershipType: payload.ownershipType,
        startedAt,
      });
      return saveOrQueue({
        save: () =>
          createAquarium({ ...payload, clientOperationId: operationId }),
        enqueue: () =>
          enqueueAquariumCreate({
            id: operationId,
            payload,
            createdAt: startedAt,
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: (result) =>
          result.ok
            ? {
                type: "queued",
                operationId: result.operationId,
                message:
                  "Nincs kapcsolat, ezért az akvárium a feltöltésre várók közé került. Amint van térerő, magától felmegy.",
              }
            : {
                type: "queue-failed",
                message: `Az akváriumot nem sikerült elmenteni a készülékre: ${result.error}`,
              },
      });
    },
    onSuccess: (outcome) => {
      if (outcome.type === "saved") {
        router.back();
        return;
      }
      if (outcome.type === "queued") {
        setNotice(outcome.message);
        setForm(emptyAquariumCreateForm());
        return;
      }
      // "rejected" vagy "lost": az űrlap tartalma megmarad, a szerelő
      // javíthat és újra próbálkozhat.
      setError({ field: null, message: outcome.message });
    },
    onError: (cause: unknown) => {
      setError({
        field: null,
        message:
          cause instanceof ApiError || cause instanceof Error
            ? cause.message
            : "Az akvárium mentése nem sikerült.",
      });
    },
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.aquariumsManage) return <Redirect href="/" />;

  function updateDimension(
    field: "lengthCm" | "widthCm" | "heightCm",
    value: string,
  ) {
    setForm((prev) => {
      const next: AquariumCreateForm = { ...prev, [field]: value };
      // ÉLŐ ELŐNÉZET: amíg a felhasználó nem írta át kézzel a litert, a mező
      // a méretekből frissül -- ugyanaz a döntési alak, mint a szerveren
      // (`resolveAquariumVolume`), csak itt a megjelenítést szolgálja.
      if (!prev.volumeManuallyEdited) {
        const volume = resolveAquariumVolume({
          lengthCm: normalizeDecimalText(next.lengthCm),
          widthCm: normalizeDecimalText(next.widthCm),
          heightCm: normalizeDecimalText(next.heightCm),
          volumeLiters: null,
          isManual: false,
        });
        next.volumeLiters =
          volume.systemVolumeLiters != null
            ? String(volume.systemVolumeLiters)
            : "";
      }
      return next;
    });
  }

  function submit() {
    const result = buildAquariumCreatePayload(form);
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      return;
    }
    setError(null);
    setNotice(null);
    mutation.mutate(result.payload);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>AKVÁRIUMOK</Text>
          <Text style={styles.title}>Új akvárium</Text>

          <Segmented<AquariumOwnershipType>
            value={form.ownershipType}
            options={["OWN", "CUSTOMER"]}
            label={(value) => OWNERSHIP_LABEL[value]}
            onChange={(ownershipType) =>
              setForm((prev) => ({ ...prev, ownershipType }))
            }
          />

          {form.ownershipType === "CUSTOMER" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Ügyfél</Text>
              <Segmented<"EXISTING" | "NEW">
                value={form.customerMode}
                options={["EXISTING", "NEW"]}
                label={(value) =>
                  value === "EXISTING" ? "Meglévő ügyfél" : "Új ügyfél"
                }
                onChange={(customerMode) =>
                  setForm((prev) => ({ ...prev, customerMode }))
                }
              />

              {form.customerMode === "EXISTING" ? (
                <CustomerPicker
                  selectedId={form.selectedCustomerId}
                  selectedLabel={form.selectedCustomerLabel}
                  error={
                    error?.field === "selectedCustomer" ? error.message : null
                  }
                  onSelect={(selectedCustomerId, selectedCustomerLabel) =>
                    setForm((prev) => ({
                      ...prev,
                      selectedCustomerId,
                      selectedCustomerLabel,
                    }))
                  }
                />
              ) : (
                <>
                  <Field
                    label="Név"
                    value={form.customerName}
                    onChangeText={(customerName) =>
                      setForm((prev) => ({ ...prev, customerName }))
                    }
                    error={
                      error?.field === "customerName" ? error.message : null
                    }
                  />
                  <Field
                    label="Telefonszám"
                    value={form.customerPhone}
                    onChangeText={(customerPhone) =>
                      setForm((prev) => ({ ...prev, customerPhone }))
                    }
                    keyboardType="phone-pad"
                  />
                  <Field
                    label="E-mail cím"
                    value={form.customerEmail}
                    onChangeText={(customerEmail) =>
                      setForm((prev) => ({ ...prev, customerEmail }))
                    }
                    keyboardType="email-address"
                  />
                  <Field
                    label="Irányítószám"
                    value={form.customerPostalCode}
                    onChangeText={(customerPostalCode) =>
                      setForm((prev) => ({ ...prev, customerPostalCode }))
                    }
                    keyboardType="number-pad"
                  />
                  <Field
                    label="Város"
                    value={form.customerCity}
                    onChangeText={(customerCity) =>
                      setForm((prev) => ({ ...prev, customerCity }))
                    }
                  />
                  <Field
                    label="Utca, házszám"
                    value={form.customerAddressLine1}
                    onChangeText={(customerAddressLine1) =>
                      setForm((prev) => ({ ...prev, customerAddressLine1 }))
                    }
                    error={
                      error?.field === "customerAddress" ? error.message : null
                    }
                  />
                </>
              )}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Az akvárium</Text>
            <Field
              label="Neve"
              value={form.name}
              onChangeText={(name) => setForm((prev) => ({ ...prev, name }))}
              error={error?.field === "name" ? error.message : null}
            />
            <Segmented<WaterBodyType>
              value={form.waterBodyType}
              options={["AKVARIUM", "TO"]}
              label={(value) => WATER_BODY_LABEL[value]}
              onChange={(waterBodyType) =>
                setForm((prev) => ({ ...prev, waterBodyType }))
              }
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Méretek és liter</Text>
            <View style={styles.row}>
              <Field
                label="Hossz (cm)"
                value={form.lengthCm}
                onChangeText={(value) => updateDimension("lengthCm", value)}
                keyboardType="decimal-pad"
                style={styles.rowField}
                error={error?.field === "lengthCm" ? error.message : null}
              />
              <Field
                label="Szélesség (cm)"
                value={form.widthCm}
                onChangeText={(value) => updateDimension("widthCm", value)}
                keyboardType="decimal-pad"
                style={styles.rowField}
                error={error?.field === "widthCm" ? error.message : null}
              />
              <Field
                label="Magasság (cm)"
                value={form.heightCm}
                onChangeText={(value) => updateDimension("heightCm", value)}
                keyboardType="decimal-pad"
                style={styles.rowField}
                error={error?.field === "heightCm" ? error.message : null}
              />
            </View>
            <Field
              label="Liter (számolva, vagy írd át kézzel)"
              value={form.volumeLiters}
              onChangeText={(volumeLiters) =>
                setForm((prev) => ({
                  ...prev,
                  volumeLiters,
                  volumeManuallyEdited: true,
                }))
              }
              keyboardType="decimal-pad"
              error={error?.field === "volumeLiters" ? error.message : null}
            />
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Eszközök</Text>
              <Pressable
                onPress={() =>
                  setForm((prev) => ({
                    ...prev,
                    equipment: [
                      ...prev.equipment,
                      emptyAquariumEquipmentForm(),
                    ],
                  }))
                }
                style={styles.addButton}
              >
                <Text style={styles.addButtonText}>+ Eszköz</Text>
              </Pressable>
            </View>

            {form.equipment.length === 0 ? (
              <Text style={styles.empty}>Még nincs felvéve eszköz.</Text>
            ) : null}

            {form.equipment.map((row, index) => (
              <View key={index} style={styles.equipmentRow}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.equipmentIndex}>{index + 1}.</Text>
                  <Pressable
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Text style={styles.removeText}>Törlés</Text>
                  </Pressable>
                </View>
                <EquipmentKindPicker
                  value={row.kind}
                  onChange={(kind) =>
                    setForm((prev) => ({
                      ...prev,
                      equipment: prev.equipment.map((r, i) =>
                        i === index ? { ...r, kind } : r,
                      ),
                    }))
                  }
                />
                <View style={styles.row}>
                  <Field
                    label="Gyártó"
                    value={row.manufacturer}
                    onChangeText={(manufacturer) =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.map((r, i) =>
                          i === index ? { ...r, manufacturer } : r,
                        ),
                      }))
                    }
                    style={styles.rowField}
                  />
                  <Field
                    label="Típus"
                    value={row.model}
                    onChangeText={(model) =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.map((r, i) =>
                          i === index ? { ...r, model } : r,
                        ),
                      }))
                    }
                    style={styles.rowField}
                  />
                </View>
                {row.kind === "NYOMELEM_ADAGOLO" ? (
                  <Field
                    label="Csatornaszám"
                    value={row.channelCount}
                    onChangeText={(channelCount) =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.map((r, i) =>
                          i === index ? { ...r, channelCount } : r,
                        ),
                      }))
                    }
                    keyboardType="number-pad"
                    error={
                      error?.field === `equipment.${index}.channelCount`
                        ? error.message
                        : null
                    }
                  />
                ) : null}
              </View>
            ))}
          </View>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {error && error.field === null ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={mutation.isPending}
            style={({ pressed }) => [
              styles.submit,
              (pressed || mutation.isPending) && styles.pressed,
            ]}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#071827" />
            ) : (
              <Text style={styles.submitText}>Mentés</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  style,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?:
    "default" | "decimal-pad" | "number-pad" | "phone-pad" | "email-address";
  style?: object;
  error?: string | null;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        placeholderTextColor="#668798"
        style={styles.input}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Segmented<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: readonly T[];
  label: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[
            styles.segmentedOption,
            value === option && styles.segmentedOptionActive,
          ]}
        >
          <Text
            style={[
              styles.segmentedText,
              value === option && styles.segmentedTextActive,
            ]}
          >
            {label(option)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A MEGLÉVŐ ÜGYFÉL VÁLASZTÓJA -- `GET /aquariums/customers`-re épít, NEM a
 * `/customers`-re (lásd `lib/api/aquariums.ts` fejlécét: a `SERVICE`
 * szerepkör azt nem éri el). Csak akkor tölt listát, amikor a panel
 * kinyílik -- a szerelő nem mindig nyúl hozzá.
 */
function CustomerPicker({
  selectedId,
  selectedLabel,
  error,
  onSelect,
}: {
  selectedId: string | null;
  selectedLabel: string;
  error?: string | null;
  onSelect: (id: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const results = useQuery({
    queryKey: ["aquarium-selectable-customers", search],
    queryFn: () => searchSelectableAquariumCustomers(search),
    enabled: open,
  });

  return (
    <View style={styles.field}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={styles.pickerToggle}
      >
        <Text style={styles.pickerToggleText}>
          {selectedId ? selectedLabel : "Válassz ügyfelet"}
        </Text>
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {open ? (
        <View style={styles.pickerPanel}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Keresés név szerint"
            placeholderTextColor="#668798"
            style={styles.input}
          />
          {results.isPending ? <ActivityIndicator color="#52d6c7" /> : null}
          {results.isError ? (
            <Text style={styles.fieldError}>
              Az ügyféllista nem tölthető be.
            </Text>
          ) : null}
          {(results.data?.items ?? []).map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                onSelect(
                  item.id,
                  item.city
                    ? `${item.displayName} (${item.city})`
                    : item.displayName,
                );
                setOpen(false);
              }}
              style={styles.pickerRow}
            >
              <Text style={styles.pickerRowText}>{item.displayName}</Text>
              {item.city ? (
                <Text style={styles.pickerRowMeta}>{item.city}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function EquipmentKindPicker({
  value,
  onChange,
}: {
  value: AquariumEquipmentKind;
  onChange: (value: AquariumEquipmentKind) => void;
}) {
  return (
    <View style={styles.kindWrap}>
      {EQUIPMENT_KIND_OPTIONS.map(([kind, kindLabel]) => (
        <Pressable
          key={kind}
          onPress={() => onChange(kind)}
          style={[styles.kindChip, value === kind && styles.kindChipActive]}
        >
          <Text
            style={[
              styles.kindChipText,
              value === kind && styles.kindChipTextActive,
            ]}
          >
            {kindLabel}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  flex: { flex: 1 },
  container: { padding: 18, paddingBottom: 48, gap: 14 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  section: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  row: { flexDirection: "row", gap: 10 },
  rowField: { flex: 1 },
  field: { gap: 6 },
  fieldLabel: { color: "#91afbe", fontSize: 12 },
  fieldError: { color: "#fecaca", fontSize: 12 },
  input: {
    color: "#f4fbff",
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  segmented: { flexDirection: "row", gap: 8 },
  segmentedOption: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#28536a",
    paddingVertical: 10,
    alignItems: "center",
  },
  segmentedOptionActive: { backgroundColor: "#52d6c7", borderColor: "#52d6c7" },
  segmentedText: { color: "#91afbe", fontWeight: "700" },
  segmentedTextActive: { color: "#071827" },
  pickerToggle: {
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pickerToggleText: { color: "#f4fbff", fontWeight: "700" },
  pickerPanel: { marginTop: 8, gap: 8 },
  pickerRow: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  pickerRowText: { color: "#f4fbff", fontWeight: "700" },
  pickerRowMeta: { color: "#789cad", fontSize: 12, marginTop: 2 },
  kindWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#28536a",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  kindChipActive: { backgroundColor: "#52d6c7", borderColor: "#52d6c7" },
  kindChipText: { color: "#91afbe", fontSize: 12, fontWeight: "700" },
  kindChipTextActive: { color: "#071827" },
  equipmentRow: {
    borderTopWidth: 1,
    borderTopColor: "#1c4963",
    paddingTop: 10,
    gap: 10,
  },
  equipmentIndex: { color: "#91afbe", fontWeight: "800" },
  addButton: {
    backgroundColor: "#164057",
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addButtonText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  removeText: { color: "#fca5a5", fontWeight: "700", fontSize: 12 },
  empty: { color: "#91afbe" },
  notice: {
    color: "#f4d9a0",
    backgroundColor: "#3a2a12",
    borderColor: "#8a6a2a",
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
  },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  submit: {
    backgroundColor: "#52d6c7",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  pressed: { opacity: 0.75 },
  submitText: { color: "#071827", fontWeight: "900", fontSize: 15 },
});
