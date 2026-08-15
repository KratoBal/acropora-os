import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
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
  createAsset,
  listAssetOwners,
  type AssetKind,
  type AssetOwnerOption,
} from "@/lib/api/assets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

const kinds: { value: AssetKind; label: string }[] = [
  { value: "SYSTEM", label: "Rendszer" },
  { value: "EQUIPMENT", label: "Berendezés" },
  { value: "COMPONENT", label: "Részegység" },
  { value: "SENSOR", label: "Szenzor" },
  { value: "OTHER", label: "Egyéb" },
];

export default function NewAssetScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const ownersQuery = useQuery({
    queryKey: ["asset-owners"],
    queryFn: listAssetOwners,
    enabled: status === "authenticated" && Boolean(capabilities?.assetsManage),
  });
  const [ownerSearch, setOwnerSearch] = useState("");
  const [owner, setOwner] = useState<AssetOwnerOption | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("EQUIPMENT");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [interval, setInterval] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filteredOwners = useMemo(() => {
    const needle = ownerSearch.trim().toLocaleLowerCase("hu");
    return (ownersQuery.data?.items ?? [])
      .filter((item) =>
        !needle
          ? true
          : `${item.displayName} ${item.code}`
              .toLocaleLowerCase("hu")
              .includes(needle),
      )
      .slice(0, 20);
  }, [ownerSearch, ownersQuery.data]);

  const mutation = useMutation({
    mutationFn: createAsset,
    onSuccess: (created) =>
      router.replace({ pathname: "/assets/[id]", params: { id: created.id } }),
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem menthető.",
      ),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsManage) return <Redirect href="/assets" />;

  const submit = () => {
    setError(null);
    if (!owner || !name.trim()) {
      setError("A partner és az eszköz neve kötelező.");
      return;
    }
    const serviceIntervalDays = interval
      ? Number.parseInt(interval, 10)
      : undefined;
    if (
      serviceIntervalDays !== undefined &&
      (!Number.isInteger(serviceIntervalDays) || serviceIntervalDays < 1)
    ) {
      setError("Az intervallum legalább 1 nap legyen.");
      return;
    }
    mutation.mutate({
      ownerType: owner.type,
      ownerId: owner.id,
      kind,
      name: name.trim(),
      manufacturer: manufacturer.trim() || undefined,
      model: model.trim() || undefined,
      serialNumber: serialNumber.trim() || undefined,
      installedAt: installedAt ? `${installedAt}T00:00:00.000Z` : undefined,
      serviceIntervalDays,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>ESZKÖZNYILVÁNTARTÁS</Text>
        <Text style={styles.title}>Új eszköz</Text>
        <Text style={styles.subtitle}>
          Mentés után az adatlapról azonnal nyomtatható a 30×30 mm-es QR-címke.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Section title="Tulajdonos">
          <TextInput
            value={ownerSearch}
            onChangeText={setOwnerSearch}
            placeholder="Vevő vagy partner keresése"
            placeholderTextColor="#668798"
            style={styles.input}
          />
          {ownersQuery.isPending ? <ActivityIndicator color="#52d6c7" /> : null}
          {filteredOwners.map((item) => {
            const selected = owner?.type === item.type && owner.id === item.id;
            return (
              <Pressable
                key={`${item.type}:${item.id}`}
                onPress={() => setOwner(item)}
                style={[styles.ownerRow, selected && styles.ownerSelected]}
              >
                <Text style={styles.ownerName}>{item.displayName}</Text>
                <Text style={styles.ownerMeta}>
                  {item.type === "CUSTOMER" ? "Vevő" : "Partner"} · {item.code}
                </Text>
              </Pressable>
            );
          })}
        </Section>

        <Section title="Eszközadatok">
          <Field label="Eszköz neve *" value={name} onChangeText={setName} />
          <Text style={styles.label}>Típus</Text>
          <View style={styles.kindGrid}>
            {kinds.map((item) => (
              <Pressable
                key={item.value}
                onPress={() => setKind(item.value)}
                style={[
                  styles.kindButton,
                  kind === item.value && styles.kindSelected,
                ]}
              >
                <Text style={styles.kindText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="Gyártó"
            value={manufacturer}
            onChangeText={setManufacturer}
          />
          <Field label="Modell" value={model} onChangeText={setModel} />
          <Field
            label="Sorozatszám"
            value={serialNumber}
            onChangeText={setSerialNumber}
          />
          <Field
            label="Telepítés dátuma (ÉÉÉÉ-HH-NN)"
            value={installedAt}
            onChangeText={setInstalledAt}
          />
          <Field
            label="Karbantartási intervallum (nap)"
            value={interval}
            onChangeText={setInterval}
            keyboardType="number-pad"
          />
        </Section>

        <Pressable
          disabled={mutation.isPending}
          onPress={submit}
          style={[styles.saveButton, mutation.isPending && styles.disabled]}
        >
          <Text style={styles.saveText}>
            {mutation.isPending ? "Mentés…" : "Eszköz létrehozása"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  keyboardType?: "default" | "number-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        placeholderTextColor="#668798"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 16 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#91afbe", lineHeight: 21 },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  section: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 17, fontWeight: "900" },
  sectionBody: { marginTop: 12, gap: 10 },
  field: { gap: 5 },
  label: { color: "#a9c4d1", fontSize: 12, fontWeight: "800" },
  input: {
    color: "#f4fbff",
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  ownerRow: {
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#21485e",
    backgroundColor: "#0a2335",
  },
  ownerSelected: { borderColor: "#52d6c7", backgroundColor: "#12443f" },
  ownerName: { color: "#f4fbff", fontWeight: "800" },
  ownerMeta: { color: "#789cad", fontSize: 11, marginTop: 2 },
  kindGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindButton: {
    backgroundColor: "#164057",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  kindSelected: { backgroundColor: "#177b74" },
  kindText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  saveButton: { backgroundColor: "#177b74", borderRadius: 12, padding: 15 },
  saveText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 15,
  },
  disabled: { opacity: 0.55 },
});
