import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { getServicePartner, listPartnerUnits } from "@/lib/api/partners";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getWebshopCapabilities } from "@/lib/auth/webshop-authorization";
import { partnerDetailRows } from "@/lib/partners/partner-presentation";
import { SectionTitle } from "@/components/SectionTitle";

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
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const capabilities = user ? getWebshopCapabilities(user.role) : null;

  const partner = useQuery({
    queryKey: ["service-partner", id],
    queryFn: () => getServicePartner(id),
    enabled: Boolean(
      id && capabilities?.partnersView && status === "authenticated",
    ),
  });

  /**
   * ALEGYSÉGEK, A TERV SZERINT (2026-09-25, Figma 13. kör,
   * `MobilePartnerDetailScreen`): a képesség (`listPartnerUnits`) már
   * megvolt, csak ez a képernyő nem hívta -- az eszköz-felvitel
   * helyszín-fájához készült. Csak az AKTÍV alegységek látszanak, ugyanaz
   * a szűrés, mint a munkalap-felvitelen (`departments.filter(isActive)`).
   */
  const units = useQuery({
    queryKey: ["partner-units", id],
    queryFn: () => listPartnerUnits(id),
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

        {partner.isPending ? <ActivityIndicator color={tokens.accent} /> : null}

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
          <Text style={styles.noticeAmber}>
            Ezen a partneren ma nincs szerviz jelölő. Az adatait látod, de a
            szerviz listákban nem szerepel.
          </Text>
        ) : null}

        {/*
          KÉT KÜLÖN SZÍN, A TERV SZERINT (2026-09-25, barracuda
          előre-összevetése, `MobilePartnerDetailScreen`): a terv a
          "nem szerviz típusú" sávot amber, az "inaktív" sávot semleges
          szürke háttérrel adja -- eddig mindkettő ugyanazt a `t.warning`
          stílust viselte.
        */}
        {partner.data && !partner.data.isActive ? (
          <Text style={styles.noticeGrey}>
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

        {/*
          ALEGYSÉGEK KÁRTYA, A TERV SZERINT: csak akkor jelenik meg, ha van
          legalább egy AKTÍV alegység -- a terv is elhagyja a kártyát, ha a
          partnernek nincs alegysége (`partner.alegysegek.length > 0`).
        */}
        {(() => {
          const aktivEgysegek = (units.data?.items ?? []).filter(
            (unit) => unit.isActive,
          );
          if (aktivEgysegek.length === 0) return null;
          return (
            <>
              <SectionTitle>Alegységek</SectionTitle>
              <View style={styles.card}>
                {aktivEgysegek.map((unit) => (
                  <View key={unit.id} style={styles.unitRow}>
                    <Text style={styles.unitCode}>{unit.code}</Text>
                    <Text style={styles.unitName}>{unit.name}</Text>
                  </View>
                ))}
              </View>
            </>
          );
        })()}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- Figma 12.
 * kör, ugyanaz a minta, mint a `login.tsx`-en (lásd ott a teljes indokot).
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 12 },
    eyebrow: {
      color: t.accent,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.4,
    },
    title: { color: t.textPrimary, fontSize: 26, fontWeight: "900" },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      gap: 12,
    },
    row: { gap: 3 },
    label: { color: t.textSecondary, fontSize: 12, fontWeight: "800" },
    value: { color: t.textPrimary, fontSize: 15 },
    unitRow: { alignItems: "center", flexDirection: "row", gap: 10 },
    unitCode: {
      backgroundColor: t.surfaceRaised,
      borderRadius: 6,
      color: t.textSecondary,
      fontFamily: "monospace",
      fontSize: 12,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    unitName: { color: t.textPrimary, fontSize: 14 },
    noticeAmber: {
      color: t.warning,
      backgroundColor: t.warningSoft,
      padding: 12,
      borderRadius: 10,
    },
    /**
     * SEMLEGES SZÜRKE, NEM FIGYELMEZTETŐ SZÍN -- a terv az "inaktív"
     * sávnak nem amber-t, hanem grey-t ad: az inaktív állapot ténymegállapítás,
     * nem probléma. Nincs pontos "grey-100" háttér-token, ezért a
     * `surfaceRaised`+`border` pár adja a legközelebbi, a kártyáktól még
     * megkülönböztethető semleges felületet -- ugyanaz a minta, mint az
     * `index.tsx` `roleBadge`-jén.
     */
    noticeGrey: {
      color: t.textSecondary,
      backgroundColor: t.surfaceRaised,
      borderColor: t.border,
      borderWidth: 1,
      padding: 12,
      borderRadius: 10,
    },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
  });
}
