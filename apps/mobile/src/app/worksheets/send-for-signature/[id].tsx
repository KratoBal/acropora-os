import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getWorksheet,
  listWorksheetSigners,
  sendWorksheetForSignature,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { kikuldhetoAlairasra } from "@/lib/worksheets/worksheet-send-for-signature";
import { worksheetLabelOrDraft } from "@/lib/worksheets/worksheet-presentation";

/**
 * KIKULDES ALAIRASRA -- A FELUGRO ABLAK.
 *
 * Balazs specje, 2026-09-18 07:01 UTC, szo szerint: "Utana felugro ablak es
 * kivalaszthatom minek kuldom el a partner alairoibol alatta gomb Elkuldom
 * alairasra."
 *
 * === MIERT KULON UTVONAL, ES NEM `Modal` ===
 *
 * Ebben az appban NULLA `<Modal>` all (ujramerve 2026-09-21), es ez leirt
 * dontes: a felugro alakot `presentation: "fullScreenModal"` adja, ugyanugy,
 * mint az alairas-kepernyonel. Egy `Modal` bevezetese kulon dontes lenne.
 *
 * === ES EGY ELTERES AZ ALAIRAS-KEPERNYOTOL, AMI NEM MULASZTAS ===
 *
 * Ott `gestureEnabled: false` all, mert azt a kepernyot a szerelo ODAADJA az
 * ugyfelnek, es egy lehuzo mozdulat az ugyfel kezebe adna a mogotte levo
 * tetel-szerkesztest. ITT a telefon VEGIG a szerelonel marad: o valasztja ki,
 * kinek kuldi el. A lehuzas elzarasa itt nem vedene semmit, csak elvenne a
 * megszokott kifele vezeto utat.
 */
export default function SendWorksheetForSignatureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const [signerUserId, setSignerUserId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const worksheet = useQuery({
    queryKey: ["worksheet", id],
    queryFn: () => getWorksheet(id),
    enabled: Boolean(id && capabilities?.worksheetsView),
  });

  /**
   * A CIMZETTEK UGYANABBOL A LISTABOL JONNEK, amibol a helyszini alairas
   * valasztoja (`signers`) -- nem egy masodik lekerdezesbol. Ket lista
   * ugyanarra a kerdesre elso nap kette valna.
   */
  const signers = useQuery({
    queryKey: ["worksheet-signers", id],
    queryFn: () => listWorksheetSigners(id),
    enabled: Boolean(id && capabilities?.worksheetsView),
  });

  const kikuldes = useMutation({
    mutationFn: (cimzett: string) => sendWorksheetForSignature(id, cimzett),
    onSuccess: async () => {
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
      await queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      /**
       * `replace`, nem `push`: a kikuldes utan a gomb eltunik az adatlapon,
       * tehat a vissza gomb egy olyan kepernyore vinne, aminek mar nincs
       * dolga. A szerelo az adatlapon latja az allapot-sorban, hogy kiment.
       */
      router.replace({ pathname: "/worksheets/[id]", params: { id } });
    },
    onError: (cause) =>
      setFormError(
        cause instanceof Error
          ? cause.message
          : "A munkalap nem küldhető ki aláírásra.",
      ),
  });

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (!capabilities?.worksheetsView)
    return <Redirect href={{ pathname: "/worksheets/[id]", params: { id } }} />;

  const current = worksheet.data?.currentVersion;

  /**
   * UGYANAZ A KAPU, MINT A GOMBON AZ ADATLAPON.
   *
   * Nem masolat: ugyanaz a fuggveny. Ha a ket hely kulon feltetelt viselne, a
   * gomb es a kepernyo elso nap kette valna -- a gomb megjelenne, a kepernyo
   * pedig visszadobna.
   */
  const kikuldheto =
    current !== undefined &&
    kikuldhetoAlairasra({
      status: current.status,
      sentForSignatureAt: current.sentForSignatureAt,
      worksheetsManage: Boolean(capabilities?.worksheetsManage),
    });

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {worksheet.isPending ? (
          <ActivityIndicator color={tokens.accent} />
        ) : null}

        {worksheet.data && current ? (
          <>
            <Text style={styles.title}>
              {worksheet.data.customer.displayName}
            </Text>
            <Text style={styles.muted}>
              {worksheetLabelOrDraft(current.label)} · {current.subject}
            </Text>

            {kikuldheto ? (
              <>
                <Text style={styles.sectionTitle}>Kinek küldjük ki</Text>
                <View style={styles.card}>
                  {signers.isPending ? (
                    <ActivityIndicator color={tokens.accent} />
                  ) : null}

                  {signers.data?.items.map((jelolt) => (
                    <Pressable
                      key={jelolt.id}
                      accessibilityRole="button"
                      onPress={() => setSignerUserId(jelolt.id)}
                      style={[
                        styles.signerOption,
                        signerUserId === jelolt.id && styles.signerOptionPicked,
                      ]}
                    >
                      <Text style={styles.signer}>{jelolt.name}</Text>
                    </Pressable>
                  ))}

                  {/*
                    AZ URES LISTA MEGMONDJA, MIERT -- a mondat a SZERVERTOL jon,
                    hogy a ket felulet ugyanazt mondja. Ket kulonbozo ok van
                    (nincs hozzakotott munkatars kontra hianyzo torzsadat), es a
                    teendojuk MAS.

                    ES ITT NINCS "EGYIK SEM" AG, az alairas-kepernyotol
                    elteroen: oda be lehet irni egy nevet, mert az ugyfel OTT
                    all es alair. Egy kikuldesnek CIMZETT kell, akinek a fiokja
                    letezik -- beirt nevre nem lehet kikuldeni.
                  */}
                  {signers.data?.emptyReason ? (
                    <Text style={styles.muted}>{signers.data.emptyReason}</Text>
                  ) : null}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Elküldöm aláírásra"
                  disabled={signerUserId === null || kikuldes.isPending}
                  onPress={() => {
                    if (signerUserId === null) return;
                    kikuldes.mutate(signerUserId);
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (signerUserId === null || kikuldes.isPending) &&
                      styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {kikuldes.isPending ? "Küldés…" : "Elküldöm aláírásra"}
                  </Text>
                </Pressable>
              </>
            ) : (
              /*
                A LAP ALLAPOTA KOZBEN MEGVALTOZHATOTT: valaki mas kikuldte,
                vagy a lap visszanyilt piszkozatba. A kepernyo ezt KIMONDJA,
                ahelyett hogy egy ures valasztot mutatna.
              */
              <Text style={styles.muted}>
                Ez a munkalap most nem küldhető ki aláírásra: vagy még
                piszkozat, vagy már kiküldtük, vagy megszületett róla a döntés.
              </Text>
            )}

            {formError ? <Text style={styles.error}>{formError}</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.background },
    container: { padding: 20, gap: 12 },
    title: { color: t.textPrimary, fontSize: 20, fontWeight: "700" },
    muted: { color: t.textSecondary, fontSize: 13 },
    sectionTitle: {
      color: t.textPrimary,
      fontSize: 15,
      fontWeight: "700",
      marginTop: 12,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 12,
      gap: 8,
    },
    signerOption: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    signerOptionPicked: {
      borderColor: t.accent,
      backgroundColor: t.surfaceRaised,
    },
    signer: { color: t.textPrimary, fontSize: 15 },
    primaryButton: {
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 12,
    },
    primaryButtonText: {
      color: t.textOnAccent,
      fontSize: 16,
      fontWeight: "700",
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.8 },
    error: { color: t.danger, fontSize: 13, marginTop: 8 },
  });
}
