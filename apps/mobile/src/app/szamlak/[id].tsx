import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { environment } from "@/config/env";
import {
  getExternalDocument,
  getIncomingDocument,
  getOwnDocument,
} from "@/lib/api/billing";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getBillingCapabilities } from "@/lib/auth/webshop-authorization";
import { openBillingPdf } from "@/lib/billing/open-billing-pdf";
import {
  externalDetailView,
  incomingDetailView,
  isDocumentKind,
  ownDetailView,
  type DetailView,
  type Tone,
} from "@/lib/billing/presentation";
import { openAttachmentDeps } from "@/lib/messages/native-files";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * SZÁMLA ADATLAP, telefonon, CSAK OLVASÁSRA (kártya 050e138b): a fejléc, a partner, a dátumok, a tételek, az összesítő
 * és a PDF. A `fajta` paraméter mondja meg, melyik végpontról jön (a saját kimenő, a külső kimenő vagy a bejövő); a
 * lista adja, a mélylinkből viszont bármi jöhet, ezért ismeretlen fajtánál a képernyő kimondja, hogy nem nyitható.
 */
export default function BillingDocumentScreen() {
  const { id, fajta } = useLocalSearchParams<{ id: string; fajta?: string }>();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const canView = user ? getBillingCapabilities(user).billingView : false;
  const kind = isDocumentKind(fajta) ? fajta : null;
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const detail = useQuery({
    queryKey: ["billing-document", kind, id],
    queryFn: async (): Promise<DetailView> => {
      if (kind === "own") return ownDetailView(await getOwnDocument(id));
      if (kind === "external")
        return externalDetailView(await getExternalDocument(id));
      return incomingDetailView(await getIncomingDocument(id));
    },
    enabled: Boolean(
      canView && status === "authenticated" && kind !== null && id,
    ),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;

  if (!canView || kind === null)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            {canView
              ? "Ez a bizonylat nem nyitható meg"
              : "Nincs hozzáférésed a számlákhoz"}
          </Text>
          <Text style={styles.errorText}>
            {canView
              ? "A hivatkozás nem mondja meg, melyik számla-fajtáról van szó. Nyisd meg a Számlák listájából."
              : "A megnyitáshoz billing.view jogosultság szükséges."}
          </Text>
        </View>
      </SafeAreaView>
    );

  const view = detail.data;

  const openPdf = async () => {
    setPdfNotice(null);
    setPdfBusy(true);
    const result = await openBillingPdf(
      { apiUrl: environment.ok ? environment.config.apiUrl : null, kind, id },
      openAttachmentDeps,
    );
    setPdfBusy(false);
    if (!result.ok) setPdfNotice(result.message);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={detail.isRefetching && !detail.isPending}
            onRefresh={() => void detail.refetch()}
            tintColor={tokens.accent}
          />
        }
      >
        {detail.isPending ? <ActivityIndicator color={tokens.accent} /> : null}

        {detail.isError ? (
          <Text style={styles.error}>
            {detail.error instanceof Error
              ? detail.error.message
              : "A számla nem tölthető be."}
          </Text>
        ) : null}

        {view ? (
          <>
            <Text style={styles.eyebrow}>{view.typeLabel.toUpperCase()}</Text>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{view.title}</Text>
              {view.badge ? (
                <Text
                  style={[styles.badge, badgeStyle(styles, view.badge.tone)]}
                >
                  {view.badge.label}
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>{view.partnerLabel}</Text>
              <Text style={styles.partnerName}>{view.partnerName}</Text>
              {view.partnerTaxNumber ? (
                <Text style={styles.muted}>
                  Adószám: {view.partnerTaxNumber}
                </Text>
              ) : null}
              {view.partnerAddress ? (
                <Text style={styles.muted}>{view.partnerAddress}</Text>
              ) : null}
            </View>

            <View style={styles.card}>
              {view.facts.map((fact) => (
                <View key={fact.label} style={styles.factRow}>
                  <Text style={styles.factLabel}>{fact.label}</Text>
                  <Text style={styles.factValue}>{fact.value}</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Tételek</Text>
              {view.lines.length === 0 ? (
                <Text style={styles.muted}>A bizonylaton nincs tétel.</Text>
              ) : (
                view.lines.map((line, index) => (
                  <View key={`${index}-${line.name}`} style={styles.lineRow}>
                    <View style={styles.lineMain}>
                      <Text style={styles.lineName}>{line.name}</Text>
                      <Text style={styles.muted}>{line.quantity}</Text>
                    </View>
                    <Text style={styles.lineAmount}>{line.gross}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              {view.totals.map((total) => (
                <View key={total.label} style={styles.factRow}>
                  <Text
                    style={
                      total.label === "Bruttó"
                        ? styles.totalLabel
                        : styles.factLabel
                    }
                  >
                    {total.label}
                  </Text>
                  <Text
                    style={
                      total.label === "Bruttó"
                        ? styles.totalValue
                        : styles.factValue
                    }
                  >
                    {total.value}
                  </Text>
                </View>
              ))}
            </View>

            {view.pdfAvailable ? (
              <Pressable
                accessibilityRole="button"
                disabled={pdfBusy}
                onPress={() => void openPdf()}
                style={({ pressed }) => [
                  styles.pdfButton,
                  (pressed || pdfBusy) && styles.pressed,
                ]}
              >
                <Text style={styles.pdfButtonText}>
                  {pdfBusy ? "PDF letöltése…" : "PDF megnyitása"}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.muted}>Ehhez a bizonylathoz nincs PDF.</Text>
            )}
            {pdfNotice ? <Text style={styles.error}>{pdfNotice}</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function badgeStyle(styles: ReturnType<typeof createStyles>, tone: Tone) {
  return tone === "success"
    ? styles.badgeSuccess
    : tone === "warning"
      ? styles.badgeWarning
      : tone === "danger"
        ? styles.badgeDanger
        : styles.badgeNeutral;
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 12 },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    eyebrow: {
      color: t.accent,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 1,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      flexWrap: "wrap",
    },
    title: {
      color: t.textPrimary,
      fontSize: 24,
      fontWeight: "900",
      flexShrink: 1,
    },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
      gap: 6,
    },
    cardLabel: {
      color: t.textMuted,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
    },
    partnerName: { color: t.textPrimary, fontSize: 16, fontWeight: "800" },
    muted: { color: t.textMuted, fontSize: 13 },
    factRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    factLabel: { color: t.textSecondary, fontSize: 14 },
    factValue: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    totalLabel: { color: t.textPrimary, fontSize: 15, fontWeight: "900" },
    totalValue: { color: t.textPrimary, fontSize: 15, fontWeight: "900" },
    lineRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 6,
      borderTopColor: t.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    lineMain: { flexShrink: 1, gap: 2 },
    lineName: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    lineAmount: { color: t.textPrimary, fontSize: 14, fontWeight: "800" },
    badge: {
      fontSize: 11,
      fontWeight: "800",
      borderRadius: 8,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeNeutral: { color: t.textSecondary, backgroundColor: t.surfaceRaised },
    badgeSuccess: { color: t.success, backgroundColor: t.successSoft },
    badgeWarning: { color: t.warning, backgroundColor: t.warningSoft },
    badgeDanger: { color: t.danger, backgroundColor: t.dangerSoft },
    pdfButton: {
      backgroundColor: t.accent,
      borderRadius: 10,
      alignItems: "center",
      paddingVertical: 13,
    },
    pdfButtonText: { color: t.textOnAccent, fontWeight: "800", fontSize: 15 },
    pressed: { opacity: 0.75 },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
    errorTitle: { color: t.textPrimary, fontSize: 18, fontWeight: "900" },
    errorText: { color: t.textSecondary, marginTop: 6, textAlign: "center" },
  });
}
