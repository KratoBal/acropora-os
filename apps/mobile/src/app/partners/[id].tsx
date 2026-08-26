import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getServicePartner } from "@/lib/api/partners";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getWebshopCapabilities } from "@/lib/auth/webshop-authorization";
import { partnerDetailRows } from "@/lib/partners/partner-presentation";

/**
 * PARTNER ADATLAP, OLVASÁSRA.
 *
 * Nincs rajta szerkesztés, és ez nem hiányosság: a szerver a `SERVICE`
 * szerepkörnek `partners.view` jogot ad, `partners.manage` jogot nem. Egy
 * gomb, amit a szerver úgyis elutasít, nem lehetőség, hanem hibaüzenet-gyár.
 *
 * Ami hiányzik az adatokból, az nem üres sorként jelenik meg: a `partnerDetailRows`
 * kihagyja. Egy üres sor a helyszínen azt állítaná, hogy tudunk róla valamit.
 */
export default function PartnerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user } = useAuth();
  const capabilities = user ? getWebshopCapabilities(user.role) : null;

  const partner = useQuery({
    queryKey: ["service-partner", id],
    queryFn: () => getServicePartner(id),
    enabled: Boolean(
      id && capabilities?.partnersView && status === "authenticated",
    ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.partnersView) return <Redirect href="/" />;

  const rows = partner.data ? partnerDetailRows(partner.data) : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>SZERVIZ PARTNER</Text>
        <Text style={styles.title}>{partner.data?.name ?? "Partner"}</Text>

        {partner.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

        {partner.isError ? (
          <Text style={styles.error}>
            {partner.error instanceof Error
              ? partner.error.message
              : "A partner adatlapja nem tölthető be."}
          </Text>
        ) : null}

        {partner.data && !partner.data.isService ? (
          /*
           * Nem szerviz partner. A listából ide nem lehet eljutni, de egy régi
           * hivatkozás vagy egy időközben levett jelölő idehozhat: jobb
           * kimondani, mint úgy tenni, mintha minden rendben lenne.
           */
          <Text style={styles.notice}>
            Ezen a partneren ma nincs szerviz jelölő. Az adatait látod, de a
            szerviz listákban nem szerepel.
          </Text>
        ) : null}

        {partner.data && !partner.data.isActive ? (
          <Text style={styles.notice}>
            Ez a partner inaktív: a törzsadata megmarad, új munkához viszont nem
            választható.
          </Text>
        ) : null}

        {rows.length > 0 ? (
          <View style={styles.card}>
            {rows.map((row) => (
              <View key={row.label} style={styles.row}>
                <Text style={styles.label}>{row.label}</Text>
                <Text style={styles.value}>{row.value}</Text>
              </View>
            ))}
          </View>
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
  title: { color: "#f4fbff", fontSize: 26, fontWeight: "900" },
  card: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  row: { gap: 3 },
  label: { color: "#a9c4d1", fontSize: 12, fontWeight: "800" },
  value: { color: "#f4fbff", fontSize: 15 },
  notice: {
    color: "#fde68a",
    backgroundColor: "#3f3115",
    padding: 12,
    borderRadius: 10,
  },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
});
