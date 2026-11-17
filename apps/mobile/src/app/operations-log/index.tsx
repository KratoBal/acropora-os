import { useQueries, useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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

import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { loadOperationsTemplates } from "@/lib/operations-log/operations-load";
import { loadStartCatalogue } from "@/lib/operations-log/start-load";
import {
  assetMeta,
  assetsInLocation,
  cacheNotice,
  emptyText,
  groupButtonLabel,
  locationsFromAssets,
  partnersFromAssets,
  startStep,
  templateDecision,
  toggleGroupSelection,
} from "@/lib/operations-log/start-picker";
import { GROUP_MAX_ASSETS } from "@/lib/operations-log/group-form";
import {
  groupRowStates,
  groupSelectionReady,
  type TemplateListState,
} from "@/lib/operations-log/group-selection";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ KEZDŐKÉPERNYŐJE (kártya f6694b49; Balázs, 2026-11-15): partner, helyszín, és ott azok az eszközök, amelyekhez
 * van aktív sablon. Az eszközre koppintva a bejegyzés rögzítése nyílik (`record.tsx`); több sablonnál a szerelő választ.
 *
 * EGY ROUTE, A LÉPÉST A PARAMÉTEREK DÖNTIK EL (`startStep`): minden szint egy `push`, tehát a visszagomb (és az Android vissza
 * mozdulata) egy szintet lép vissza, és a képernyő nem tart saját navigációs állapotot, ami a visszalépéskor elveszne.
 *
 * AMIT A KÉPERNYŐ NEM DÖNT EL: ki kerül a listába, és mit mond az üres lista. Azok a `start-picker.ts`-ben állnak, spec-kel.
 * A KÉPERNYŐT NEM FUTTATTAM TELEFONON: a komponensekre nincs teszt ebben az appban; a döntések és a bekötés mérve van.
 */
export default function OperationsLogStartScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  // az eszközlistán kipipált eszközök a csoportos rögzítéshez (kártya 1a35e8f3); a lépés saját képernyő-példány, tehát a jelölés lépésenként új
  const [selected, setSelected] = useState<string[]>([]);
  const capabilities = user ? getServiceCapabilities(user) : null;
  const params = useLocalSearchParams<{
    partnerId?: string;
    partnerName?: string;
    locationId?: string;
    locationLabel?: string;
    assetId?: string;
    assetName?: string;
  }>();
  const step = startStep(params);
  const enabled =
    Boolean(capabilities?.operationsLogRecord) && status === "authenticated";

  // EGY katalógus, három lista: a partner, a helyszín és az eszköz ugyanabból a halmazból épül (`start-picker.ts`)
  const catalogue = useQuery({
    queryKey: ["operations-start", "catalogue"],
    queryFn: loadStartCatalogue,
    enabled: enabled && step !== "templates",
  });
  // ugyanaz a kulcs és betöltő, mint az eszköz lapján: a már betöltött lista ott is, itt is él
  const templates = useQuery({
    queryKey: ["operations-templates", params.assetId],
    queryFn: () => loadOperationsTemplates(params.assetId!),
    enabled: enabled && step === "templates",
  });

  /*
    A CSOPORTOS KIJELÖLÉS SZŰKÍTÉSE (Balázs, 2026-11-17; `group-selection.ts`): az ELSŐ kijelölés után a megnyitott helyszín eszközeinek
    sablon-listája kell, eszközönként egy hívás, UGYANAZZAL a kulccsal és betöltővel, mint a csoportos képernyőn és az eszköz lapján (a
    lista ott nem tölt újra, térerő nélkül a mentett másolatból jön). Addig (nincs kijelölés) egyetlen plusz hívás sincs.
  */
  const deviceAssets =
    step === "devices" && catalogue.data
      ? assetsInLocation(
          catalogue.data.assets,
          params.partnerId!,
          params.locationId!,
        )
      : [];
  const deviceTemplates = useQueries({
    queries: deviceAssets.map((asset) => ({
      queryKey: ["operations-templates", asset.id],
      queryFn: () => loadOperationsTemplates(asset.id),
      enabled: enabled && selected.length > 0,
    })),
  });
  const templateStates: Record<string, TemplateListState> = {};
  deviceAssets.forEach((asset, index) => {
    const query = deviceTemplates[index];
    templateStates[asset.id] = query?.data
      ? query.data.items
      : query?.isError
        ? "failed"
        : undefined;
  });
  const rowStates = groupRowStates({
    assetIds: deviceAssets.map((asset) => asset.id),
    selected,
    templates: templateStates,
  });
  const groupReady = groupSelectionReady({
    selected,
    templates: templateStates,
  });

  const decision =
    step === "templates" && templates.data
      ? templateDecision(templates.data.items)
      : null;
  // egy sablonnál nincs mit kérdezni: a rögzítés a lista HELYÉRE nyílik, így a vissza az eszközlistára visz
  useEffect(() => {
    if (decision?.kind !== "record") return;
    router.replace({
      pathname: "/operations-log/record",
      params: {
        assetId: params.assetId,
        assetName: params.assetName,
        templateId: decision.templateId,
      },
    });
  }, [decision, params.assetId, params.assetName, router]);

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.operationsLogRecord) return <Redirect href="/" />;

  const active = step === "templates" ? templates : catalogue;
  const fromCache = active.data?.fromCache ?? false;

  const title =
    step === "partners"
      ? "Partner"
      : step === "locations"
        ? (params.partnerName ?? "Helyszín")
        : step === "devices"
          ? (params.locationLabel ?? "Eszköz")
          : (params.assetName ?? "Sablon");
  const eyebrow =
    step === "partners"
      ? "1. LÉPÉS: PARTNER"
      : step === "locations"
        ? "2. LÉPÉS: HELYSZÍN"
        : step === "devices"
          ? "3. LÉPÉS: ESZKÖZ"
          : "4. LÉPÉS: SABLON";

  // a cím az utolsó szint: a felette állók a morzsa (a cím nem ismétlődik benne)
  const trail =
    step === "partners"
      ? "Válaszd ki a partnert, a helyszínt és az eszközt, amelyhez bejegyzést rögzítesz."
      : step === "locations"
        ? null
        : step === "devices"
          ? params.partnerName
          : [params.partnerName, params.locationLabel]
              .filter(Boolean)
              .join(" › ");

  type Row = {
    key: string;
    title: string;
    meta?: string;
    onPress: () => void;
    /** Az eszköz azonosítója, ha a sor kipipálható a csoportos rögzítéshez (csak az eszközlistán). */
    selectId?: string;
  };
  let rows: Row[] = [];
  const assets = catalogue.data?.assets ?? [];
  if (step === "partners" && catalogue.data)
    rows = partnersFromAssets(assets).map((partner) => ({
      key: partner.id,
      title: partner.name,
      onPress: () =>
        router.push({
          pathname: "/operations-log",
          params: { partnerId: partner.id, partnerName: partner.name },
        }),
    }));
  if (step === "locations" && catalogue.data)
    rows = locationsFromAssets(assets, params.partnerId!).map((location) => ({
      key: location.id,
      title: location.label,
      onPress: () =>
        router.push({
          pathname: "/operations-log",
          params: {
            partnerId: params.partnerId,
            partnerName: params.partnerName,
            locationId: location.id,
            locationLabel: location.label,
          },
        }),
    }));
  if (step === "devices" && catalogue.data)
    rows = assetsInLocation(assets, params.partnerId!, params.locationId!).map(
      (asset) => ({
        key: asset.id,
        selectId: asset.id,
        title: asset.name,
        meta: assetMeta(asset),
        onPress: () =>
          router.push({
            pathname: "/operations-log",
            params: {
              partnerId: params.partnerId,
              partnerName: params.partnerName,
              locationId: params.locationId,
              locationLabel: params.locationLabel,
              assetId: asset.id,
              assetName: asset.name,
            },
          }),
      }),
    );
  if (decision?.kind === "choose" && templates.data)
    rows = templates.data.items.map((template) => ({
      key: template.id,
      title: template.name,
      meta:
        template.description ?? "Rögzítés: kezdés, értékek, fényképek, kész",
      onPress: () =>
        router.push({
          pathname: "/operations-log/record",
          params: {
            assetId: params.assetId,
            assetName: params.assetName,
            templateId: template.id,
          },
        }),
    }));

  const loading = active.isPending || decision?.kind === "record";
  const showEmpty =
    !active.isPending &&
    !active.isError &&
    decision?.kind !== "record" &&
    rows.length === 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={active.isRefetching && !active.isPending}
            onRefresh={() => void active.refetch()}
            tintColor={tokens.accent}
          />
        }
      >
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        {trail ? <Text style={styles.trail}>{trail}</Text> : null}

        {fromCache ? <Text style={styles.notice}>{cacheNotice}</Text> : null}

        {loading ? <ActivityIndicator color={tokens.accent} /> : null}

        {active.isError ? (
          <Text style={styles.error}>
            {active.error instanceof Error
              ? active.error.message
              : "A lista nem tölthető be."}
          </Text>
        ) : null}

        {showEmpty ? (
          <Text style={styles.empty}>{emptyText(step, fromCache)}</Text>
        ) : null}

        {rows.map((row) => {
          const checked = row.selectId
            ? selected.includes(row.selectId)
            : false;
          const rowState = row.selectId ? rowStates[row.selectId] : undefined;
          // nem jelölhető: másik sablonú, még töltődő vagy be nem töltött eszköz (a kijelölt mindig kivehető)
          const checkDisabled =
            rowState?.kind === "blocked" || rowState?.kind === "loading";
          const blockedText =
            rowState?.kind === "blocked"
              ? rowState.reason
              : rowState?.kind === "loading"
                ? "Sablon ellenőrzése…"
                : null;
          return (
            <View key={row.key} style={styles.rowLine}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={row.title}
                onPress={row.onPress}
                style={({ pressed }) => [
                  styles.row,
                  styles.rowGrow,
                  pressed && styles.pressed,
                ]}
              >
                <View>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  {row.meta ? (
                    <Text style={styles.rowMeta}>{row.meta}</Text>
                  ) : null}
                  {blockedText ? (
                    <Text style={styles.rowBlocked}>{blockedText}</Text>
                  ) : null}
                </View>
              </Pressable>
              {row.selectId ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: checkDisabled }}
                  disabled={checkDisabled}
                  accessibilityLabel={`${row.title}: kijelölés a csoportos rögzítéshez`}
                  onPress={() =>
                    setSelected((prev) =>
                      toggleGroupSelection(
                        prev,
                        row.selectId!,
                        GROUP_MAX_ASSETS,
                      ),
                    )
                  }
                  style={[
                    styles.check,
                    checked && styles.checkOn,
                    checkDisabled && styles.checkOff,
                  ]}
                >
                  <Text
                    style={[styles.checkText, checked && styles.checkTextOn]}
                  >
                    {checked ? "✓" : ""}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {step === "devices" && groupButtonLabel(selected.length) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !groupReady }}
            disabled={!groupReady}
            onPress={() =>
              router.push({
                pathname: "/operations-log/group",
                params: {
                  assets: JSON.stringify(
                    selected.map((id) => ({
                      id,
                      name: assets.find((asset) => asset.id === id)?.name ?? "",
                    })),
                  ),
                },
              })
            }
            style={[styles.groupButton, !groupReady && styles.groupButtonOff]}
          >
            <Text style={styles.groupButtonText}>
              {groupButtonLabel(selected.length)}
            </Text>
          </Pressable>
        ) : null}
        {step === "devices" && rows.length > 1 && selected.length === 0 ? (
          <Text style={styles.groupHint}>
            Több azonos sablonú eszközt együtt is rögzíthetsz: jelöld ki őket a
            jobb oldali négyzettel.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 12 },
    eyebrow: {
      color: t.accent,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 1,
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "900" },
    trail: { color: t.textSecondary },
    notice: {
      color: t.textSecondary,
      backgroundColor: t.surfaceRaised,
      padding: 12,
      borderRadius: 10,
      fontSize: 12,
    },
    rowLine: { flexDirection: "row", alignItems: "stretch", gap: 10 },
    rowGrow: { flex: 1 },
    check: {
      width: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: { backgroundColor: t.accent, borderColor: t.accent },
    checkOff: { opacity: 0.35 },
    checkText: { color: t.textPrimary, fontSize: 18, fontWeight: "900" },
    checkTextOn: { color: t.background },
    groupButton: {
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: "center",
    },
    groupButtonOff: { opacity: 0.4 },
    groupButtonText: { color: t.background, fontSize: 15, fontWeight: "800" },
    groupHint: { color: t.textMuted, fontSize: 12 },
    row: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
    },
    pressed: { opacity: 0.75 },
    rowTitle: { color: t.textPrimary, fontSize: 16, fontWeight: "800" },
    rowMeta: { color: t.textMuted, fontSize: 12, marginTop: 3 },
    rowBlocked: { color: t.textMuted, fontSize: 12, marginTop: 3 },
    empty: { color: t.textSecondary },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
  });
}
