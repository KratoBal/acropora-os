import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  createAquarium,
  type AquariumOwnershipType,
  type CreateAquariumEquipmentInput,
  type CreateAquariumInput,
  type WaterBodyType,
  type WaterType,
} from "@/lib/api/aquariums";
import {
  aquariumFormError,
  emptyEquipmentDraft,
  emptyNewCustomerDraft,
  equipmentDraftError,
  type EquipmentDraft,
} from "@/lib/aquariums/aquarium-form";
import {
  EQUIPMENT_KIND_LABELS,
  EQUIPMENT_KIND_OPTIONS,
  equipmentRequiresChannelCount,
  OWNERSHIP_OPTIONS,
  WATER_BODY_OPTIONS,
} from "@/lib/aquariums/aquarium-presentation";
import { volumeLitersFromDimensions } from "@/lib/aquariums/aquarium-volume";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

/** A számolt és a kézzel írt liter közötti választás a szöveges mezőn múlik:
 * amíg a felhasználó nem nyúlt hozzá, a mérettől számolt érték tölti ki, és
 * onnantól a kézi érték marad, amíg vissza nem állítja (brief 3. döntés). */
function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export default function NewAquariumScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const [name, setName] = useState("");
  const [ownershipType, setOwnershipType] =
    useState<AquariumOwnershipType>("OWN");
  const [waterBodyType, setWaterBodyType] = useState<WaterBodyType>("AKVARIUM");
  const [waterType, setWaterType] = useState<WaterType | null>(null);
  const [startedAt, setStartedAt] = useState("");
  const [notes, setNotes] = useState("");

  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [litersInput, setLitersInput] = useState("");
  const [manualLiters, setManualLiters] = useState(false);

  const [newCustomer, setNewCustomer] = useState(emptyNewCustomerDraft());

  const [equipment, setEquipment] = useState<
    { input: CreateAquariumEquipmentInput; label: string }[]
  >([]);
  const [draft, setDraft] = useState<EquipmentDraft>(
    emptyEquipmentDraft("VILAGITAS"),
  );
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.aquariumsManage) return <Redirect href="/aquariums" />;

  const computedLiters = volumeLitersFromDimensions(
    toNumberOrNull(lengthCm),
    toNumberOrNull(widthCm),
    toNumberOrNull(heightCm),
  );

  function onDimensionChange(setter: (value: string) => void, value: string) {
    setter(value);
    if (!manualLiters) {
      const liters = volumeLitersFromDimensions(
        toNumberOrNull(setter === setLengthCm ? value : lengthCm),
        toNumberOrNull(setter === setWidthCm ? value : widthCm),
        toNumberOrNull(setter === setHeightCm ? value : heightCm),
      );
      setLitersInput(liters === null ? "" : String(liters));
    }
  }

  function addEquipment() {
    const error = equipmentDraftError(draft);
    if (error) {
      setEquipmentError(error);
      return;
    }
    setEquipmentError(null);
    const input: CreateAquariumEquipmentInput = {
      kind: draft.kind,
      quantity: Number(draft.quantity),
      ...(draft.manufacturer.trim()
        ? { manufacturer: draft.manufacturer.trim() }
        : {}),
      ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
      ...(equipmentRequiresChannelCount(draft.kind)
        ? { channelCount: Number(draft.channelCount) }
        : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    };
    const label = `${EQUIPMENT_KIND_LABELS[draft.kind]}${
      (input.quantity ?? 1) > 1 ? ` × ${input.quantity}` : ""
    }${input.channelCount ? ` (${input.channelCount} csatorna)` : ""}`;
    setEquipment((rows) => [...rows, { input, label }]);
    setDraft(emptyEquipmentDraft(draft.kind));
  }

  function removeEquipment(index: number) {
    setEquipment((rows) => rows.filter((_, i) => i !== index));
  }

  async function submit() {
    const formError = aquariumFormError({
      name,
      ownershipType,
      // MEGLÉVŐ ÜGYFÉL KERESÉSE MOBILON NINCS (lásd a lenti panel jegyzetét
      // és `lib/api/aquariums.ts` fejlécét) -- ez a képernyő mindig az ÚJ
      // ügyfél ágat kéri, ha a tulajdon "Ügyfél".
      customerMode: "NEW",
      selectedCustomerId: null,
      newCustomer,
    });
    if (formError) {
      setSubmitError(formError);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const input: CreateAquariumInput = {
        name: name.trim(),
        ownershipType,
        waterBodyType,
        equipment: equipment.map((row) => row.input),
        ...(lengthCm.trim()
          ? { lengthCm: toNumberOrNull(lengthCm) ?? undefined }
          : {}),
        ...(widthCm.trim()
          ? { widthCm: toNumberOrNull(widthCm) ?? undefined }
          : {}),
        ...(heightCm.trim()
          ? { heightCm: toNumberOrNull(heightCm) ?? undefined }
          : {}),
        ...(litersInput.trim()
          ? {
              systemVolumeLiters: toNumberOrNull(litersInput) ?? undefined,
              systemVolumeIsManual: manualLiters,
            }
          : {}),
        ...(waterType ? { waterType } : {}),
        ...(startedAt.trim() ? { startedAt: startedAt.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      if (ownershipType === "CUSTOMER") {
        input.newCustomer = {
          type: "PERSON",
          displayName: newCustomer.displayName.trim(),
          ...(newCustomer.phone.trim()
            ? { phone: newCustomer.phone.trim() }
            : {}),
          ...(newCustomer.email.trim()
            ? { email: newCustomer.email.trim() }
            : {}),
          ...(newCustomer.postalCode.trim()
            ? {
                addresses: [
                  {
                    type: "OTHER",
                    postalCode: newCustomer.postalCode.trim(),
                    city: newCustomer.city.trim(),
                    line1: newCustomer.line1.trim(),
                    isDefault: true,
                  },
                ],
              }
            : {}),
        };
      }

      const created = await createAquarium(input);
      router.replace({
        pathname: "/aquariums/[id]",
        params: { id: created.id },
      });
    } catch (cause) {
      setSubmitError(
        cause instanceof Error ? cause.message : "Az akvárium nem menthető el.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>SZERVIZ</Text>
        <Text style={styles.title}>Új akvárium</Text>

        <Text style={styles.label}>Neve</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Nappali akvárium"
          placeholderTextColor="#668798"
          style={styles.input}
        />

        <Text style={styles.label}>Víztest</Text>
        <View style={styles.chipRow}>
          {WATER_BODY_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={waterBodyType === option.value}
              onPress={() => setWaterBodyType(option.value)}
            />
          ))}
        </View>

        <Text style={styles.label}>Tulajdon</Text>
        <View style={styles.chipRow}>
          {OWNERSHIP_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={ownershipType === option.value}
              onPress={() => setOwnershipType(option.value)}
            />
          ))}
        </View>

        {ownershipType === "CUSTOMER" ? (
          /*
            CSAK ÚJ ÜGYFÉL FELVITELE, MEGLÉVŐ KERESÉSE NÉLKÜL -- ez nem
            leegyszerűsítés, hanem a valódi API határa: a `SERVICE` szerepkör
            nem viseli a `customers.view`/`customers.manage` jogot, és az
            akvárium-vezérlő ma nem ad ehhez saját, szűkebb keresőt (lásd
            `lib/api/aquariums.ts` fejlécét). A brief mobil-ága is kimondottan
            a helyben felvitelt kérte, nem a keresést.
          */
          <View style={styles.section}>
            <Text style={styles.label}>Ügyfél neve</Text>
            <TextInput
              value={newCustomer.displayName}
              onChangeText={(value) =>
                setNewCustomer((current) => ({
                  ...current,
                  displayName: value,
                }))
              }
              placeholder="Kovács János"
              placeholderTextColor="#668798"
              style={styles.input}
            />
            <Text style={styles.label}>Telefonszám</Text>
            <TextInput
              value={newCustomer.phone}
              onChangeText={(value) =>
                setNewCustomer((current) => ({ ...current, phone: value }))
              }
              placeholder="+36 30 000 0000"
              placeholderTextColor="#668798"
              keyboardType="phone-pad"
              style={styles.input}
            />
            <Text style={styles.label}>E-mail cím</Text>
            <TextInput
              value={newCustomer.email}
              onChangeText={(value) =>
                setNewCustomer((current) => ({ ...current, email: value }))
              }
              placeholder="nev@pelda.hu"
              placeholderTextColor="#668798"
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
            <Text style={styles.label}>Cím (opcionális)</Text>
            <TextInput
              value={newCustomer.postalCode}
              onChangeText={(value) =>
                setNewCustomer((current) => ({
                  ...current,
                  postalCode: value,
                }))
              }
              placeholder="Irányítószám"
              placeholderTextColor="#668798"
              keyboardType="number-pad"
              style={styles.input}
            />
            <TextInput
              value={newCustomer.city}
              onChangeText={(value) =>
                setNewCustomer((current) => ({ ...current, city: value }))
              }
              placeholder="Település"
              placeholderTextColor="#668798"
              style={styles.input}
            />
            <TextInput
              value={newCustomer.line1}
              onChangeText={(value) =>
                setNewCustomer((current) => ({ ...current, line1: value }))
              }
              placeholder="Utca, házszám"
              placeholderTextColor="#668798"
              style={styles.input}
            />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Méretek</Text>
        <View style={styles.dimensionRow}>
          <TextInput
            value={lengthCm}
            onChangeText={(value) => onDimensionChange(setLengthCm, value)}
            placeholder="Hossz (cm)"
            placeholderTextColor="#668798"
            keyboardType="decimal-pad"
            style={[styles.input, styles.dimensionInput]}
          />
          <TextInput
            value={widthCm}
            onChangeText={(value) => onDimensionChange(setWidthCm, value)}
            placeholder="Szélesség (cm)"
            placeholderTextColor="#668798"
            keyboardType="decimal-pad"
            style={[styles.input, styles.dimensionInput]}
          />
          <TextInput
            value={heightCm}
            onChangeText={(value) => onDimensionChange(setHeightCm, value)}
            placeholder="Magasság (cm)"
            placeholderTextColor="#668798"
            keyboardType="decimal-pad"
            style={[styles.input, styles.dimensionInput]}
          />
        </View>

        <Text style={styles.label}>
          Liter{" "}
          {!manualLiters && computedLiters !== null
            ? "(a méretekből számolva)"
            : null}
        </Text>
        <TextInput
          value={litersInput}
          onChangeText={(value) => {
            setLitersInput(value);
            setManualLiters(true);
          }}
          placeholder="Liter"
          placeholderTextColor="#668798"
          keyboardType="decimal-pad"
          style={styles.input}
        />
        {manualLiters && computedLiters !== null ? (
          <Pressable
            onPress={() => {
              setManualLiters(false);
              setLitersInput(String(computedLiters));
            }}
          >
            <Text style={styles.linkText}>
              Számolt érték visszaállítása ({computedLiters} l)
            </Text>
          </Pressable>
        ) : null}

        <Text style={styles.sectionTitle}>Eszközök</Text>
        {equipment.map((row, index) => (
          <View key={`${row.input.kind}-${index}`} style={styles.equipmentRow}>
            <Text style={styles.equipmentLabel}>{row.label}</Text>
            <Pressable onPress={() => removeEquipment(index)}>
              <Text style={styles.removeText}>Törlés</Text>
            </Pressable>
          </View>
        ))}

        <View style={styles.chipRow}>
          {EQUIPMENT_KIND_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={draft.kind === option.value}
              onPress={() =>
                setDraft((current) => ({ ...current, kind: option.value }))
              }
            />
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
        {equipmentRequiresChannelCount(draft.kind) ? (
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
        <TextInput
          value={draft.notes}
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, notes: value }))
          }
          placeholder="Megjegyzés (opcionális)"
          placeholderTextColor="#668798"
          style={styles.input}
        />
        {equipmentError ? (
          <Text style={styles.error}>{equipmentError}</Text>
        ) : null}
        <Pressable
          onPress={addEquipment}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonText}>Eszköz hozzáadása</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Egyéb (opcionális)</Text>
        <View style={styles.chipRow}>
          <Chip
            label="Nincs megadva"
            selected={waterType === null}
            onPress={() => setWaterType(null)}
          />
          <Chip
            label="Édesvízi"
            selected={waterType === "EDESVIZI"}
            onPress={() => setWaterType("EDESVIZI")}
          />
          <Chip
            label="Tengeri"
            selected={waterType === "TENGERI"}
            onPress={() => setWaterType("TENGERI")}
          />
        </View>
        <TextInput
          value={startedAt}
          onChangeText={setStartedAt}
          placeholder="Indítás dátuma (ÉÉÉÉ-HH-NN)"
          placeholderTextColor="#668798"
          style={styles.input}
        />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Megjegyzés"
          placeholderTextColor="#668798"
          style={styles.input}
          multiline
        />

        {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
        <Pressable
          disabled={submitting}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
            submitting && styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>
            {submitting ? "Mentés…" : "Akvárium mentése"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
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
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900", marginBottom: 8 },
  sectionTitle: {
    color: "#f4fbff",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 16,
  },
  section: { gap: 8, marginTop: 4 },
  label: { color: "#91afbe", fontSize: 12, marginTop: 10 },
  input: {
    color: "#f4fbff",
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  dimensionRow: { flexDirection: "row", gap: 8 },
  dimensionInput: { flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
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
  linkText: {
    color: "#52d6c7",
    fontSize: 12,
    marginTop: 4,
    textDecorationLine: "underline",
  },
  equipmentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
  },
  equipmentLabel: { color: "#f4fbff", flexShrink: 1 },
  removeText: { color: "#fca5a5", fontWeight: "700" },
  primaryButton: {
    marginTop: 20,
    borderRadius: 10,
    backgroundColor: "#177b74",
    paddingHorizontal: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  secondaryButton: {
    marginTop: 10,
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
    marginTop: 8,
  },
});
