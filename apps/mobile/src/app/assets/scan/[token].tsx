import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useEffect } from "react";

import { scanAsset, scanAssetByLabel } from "@/lib/api/assets";
import { describeScanFailure } from "@/lib/assets/scan-failure";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  readCachedAssetByToken,
  rememberAssetDetail,
} from "@/lib/offline/asset-cache";

export default function AssetScanScreen() {
  const params = useLocalSearchParams<{
    token: string | string[];
    kind?: string | string[];
  }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  /**
   * MELYIK AZONOSITOT KAPTUK. A beolvaso mar eldontotte; ez a kepernyo csak
   * annyit tesz, hogy a MASIK vegpontot hivja.
   *
   * A DONTES NEM ITT ISMETLODIK MEG, es ez szandekos: ha itt is dontenenk,
   * a ket hely kulon csuszhatna el -- es a masodikat semmi nem merne.
   */
  const kindParam = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const label = kindParam === "label";
  const { status } = useAuth();
  const query = useQuery({
    queryKey: ["service-asset-scan", label ? "label" : "qr", token],
    /**
     * A MATRICA-VALASZ UNIO, ES A KET AGA KET KULON KEPERNYOT JELENT.
     *
     * A #995 ota a vegpont megkulonbozteti a SZABAD kodot attol, amit nem
     * talalt. A FEL 1-ben ez a sor meg visszadobta a 404-et, mert a kepernyo
     * nem tudott mit kezdeni vele -- most MAR TUD: a szabad kodra ket gomb
     * jelenik meg (uj eszkoz / hozzaadas meglevohoz).
     *
     * A `null` ITT IS KIZART: a kepernyo a hianyzo adatot TOLTESKENT olvasna,
     * es orokke porgo jelzot mutatna. Ezert a szabad eset SAJAT ERTEKKEL ter
     * vissza, nem a hianyaval.
     */
    queryFn: async () => {
      if (!label)
        return { kind: "ASSET" as const, asset: await scanAsset(token!) };
      return scanAssetByLabel(token!);
    },
    enabled: status === "authenticated" && Boolean(token),
    retry: false,
  });

  /*
   * A MATRICA FELOLDÁSA TÉRERŐ NÉLKÜL.
   *
   * A készüléken tárolt másolat a `qrToken` mezőt is tartalmazza -- a szerver
   * pontosan ezért küldi a listán is --, tehát a beolvasott kódról offline is
   * meg tudjuk mondani, melyik eszköz az. A keresés CSAK akkor indul, ha a
   * szerverhez fordulás elhasalt: amíg van válasz, az a friss.
   */
  /**
   * A MATRICAKODRA MA NINCS OFFLINE FELOLDAS, ES EZT KIMONDOM.
   *
   * A mentett masolat `qr_token` oszlopon keresi ki az eszkozt; matricakod
   * oszlop nincs a helyi tablan. Vagyis terero nelkul a QR-kod feloldodik, a
   * matrica NEM -- es ez nem elnezes, hanem a mai hatar.
   *
   * A FELOLDASA NEM DRAGA (a `labelCode` ott all a mentett sor torzseben,
   * tehat egy JS-oldali vegigolvasas eldontene), de KULON kor: ez a valtozas
   * az ELES akadalyt bontja el, es egy helyi sema-kerdest nem keverek bele.
   */
  const cached = useQuery({
    queryKey: ["offline-scan", token],
    queryFn: () => readCachedAssetByToken(token!),
    enabled: query.isError && Boolean(token) && !label,
  });

  // Amit a matricáról nyitottak meg, az legyen meg a következő alkalomra is.
  // A SZABAD kodhoz nincs mit elmenteni: nincs mogotte eszkoz.
  useEffect(() => {
    if (query.data?.kind !== "ASSET") return;
    void rememberAssetDetail(query.data.asset);
  }, [query.data]);

  const cachedId = cached.data?.detail?.id ?? cached.data?.summary?.id ?? null;

  if (status !== "authenticated")
    return token ? (
      <Redirect href={{ pathname: "/login", params: { assetToken: token } }} />
    ) : (
      <Redirect href="/login" />
    );
  if (query.data?.kind === "ASSET")
    return (
      <Redirect
        href={{ pathname: "/assets/[id]", params: { id: query.data.asset.id } }}
      />
    );

  /*
   * A MENTETT PÉLDÁNYRA UGRUNK. Az adatlap maga mondja ki, hogy mentett
   * másolatot mutat, és azt is, ha csak a listasor van meg -- itt tehát nem
   * kell külön üzenet, csak a feloldás.
   */
  if (cachedId)
    return (
      <Redirect href={{ pathname: "/assets/[id]", params: { id: cachedId } }} />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.card}>
        {query.data?.kind === "FREE" ? (
          <SzabadMatricaKartya code={query.data.code} />
        ) : query.isError && !cached.isPending ? (
          <ScanFailureCard
            error={query.error}
            searchedOfflineCopy={cached.isSuccess}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <ActivityIndicator color="#52d6c7" size="large" />
            <Text style={styles.title}>Eszköz azonosítása…</Text>
            <Text style={styles.text}>
              {label
                ? "A matrica kódjához keressük az eszközt az Acropora OS-ben."
                : "A QR-kódot biztonságosan ellenőrizzük az Acropora OS-ben."}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

/**
 * A SZABAD MATRICA KET UTJA -- EZ A FEL 2 BELEPESI PONTJA.
 *
 * A szerelo egy KINYOMTATOTT, de meg senkire nem ragasztott matricat olvasott
 * be. Ketfele szandek all emogott, es a kettot NEM lehet kitalalni helyette:
 *
 *     uj eszkozt vesz fel, es ez lesz a matricaja
 *     egy MAR MEGLEVO eszkozre ragasztja fel
 *
 * 2026-09-22-ig a kepernyo egyiket sem kinalta: a szabad kod ugyanazt a
 * „nem talalhato" kartyat kapta, mint egy ismeretlen. A szerelo tehat egy ep
 * matricarol azt olvasta, hogy baj van vele.
 *
 * A KOD MINDKET GOMBBAL UTAZIK, es ez a lenyeg: a kovetkezo kepernyo elotolti
 * belole a mezot, tehat a szerelonek nem kell kezzel atgepelnie azt, amit az
 * imént beolvasott.
 */
function SzabadMatricaKartya({ code }: { code: string }) {
  const router = useRouter();
  return (
    <>
      <Text style={styles.title}>Szabad matrica: {code}</Text>
      <Text style={styles.text}>
        Ez a kód ki van nyomtatva, de még nincs eszközhöz rendelve. Mit
        szeretnél vele?
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Új eszköz felvitele ezzel a matricával"
        onPress={() =>
          router.replace({
            pathname: "/assets/new",
            params: { labelCode: code },
          })
        }
        style={({ pressed }) => [styles.gomb, pressed && styles.gombNyomva]}
      >
        <Text style={styles.gombFelirat}>Új eszköz felvitele</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hozzáadás meglévő eszközhöz"
        onPress={() =>
          router.replace({
            pathname: "/assets",
            params: { valasztKodhoz: code },
          })
        }
        style={({ pressed }) => [
          styles.gomb,
          styles.gombMasodlagos,
          pressed && styles.gombNyomva,
        ]}
      >
        <Text style={styles.gombFelirat}>Hozzáadás meglévő eszközhöz</Text>
      </Pressable>
    </>
  );
}

/**
 * Says which of the two failures happened. Without the distinction the
 * screen blamed the sticker for a missing signal, and someone standing in
 * a basement would go and replace a QR code that was never broken.
 */
function ScanFailureCard({
  error,
  searchedOfflineCopy,
  onRetry,
}: {
  error: unknown;
  searchedOfflineCopy: boolean;
  onRetry(): void;
}) {
  const failure = describeScanFailure(error, { searchedOfflineCopy });
  return (
    <>
      <Text style={styles.title}>{failure.title}</Text>
      <Text style={styles.text}>{failure.message}</Text>
      {failure.canRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Beolvasás újrapróbálása"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.retryText}>Újrapróbálás</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  gomb: {
    marginTop: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "#52d6c7",
    alignSelf: "stretch",
  },
  gombMasodlagos: { backgroundColor: "#21485e" },
  gombNyomva: { opacity: 0.8 },
  gombFelirat: {
    color: "#041b28",
    fontWeight: "800",
    textAlign: "center",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#071827",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#1c4963",
    backgroundColor: "#0d2b40",
    padding: 28,
    gap: 12,
  },
  title: {
    color: "#f4fbff",
    fontSize: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  text: { color: "#a9c4d1", fontSize: 14, lineHeight: 21, textAlign: "center" },
  retryButton: {
    backgroundColor: "#177b74",
    borderRadius: 10,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retryText: { color: "#fff", fontWeight: "800" },
  pressed: { opacity: 0.7 },
});
