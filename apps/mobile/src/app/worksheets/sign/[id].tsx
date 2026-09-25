import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getWorksheet,
  listWorksheetSigners,
  signWorksheet,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { eyebrowStyle } from "@/lib/theme/label-styles";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  worksheetLabelOrDraft,
  worksheetStatusLabel,
} from "@/lib/worksheets/worksheet-presentation";
import { unlockWithBiometrics } from "@/lib/auth/biometric-unlock";
import { selfSignatureGate } from "@/lib/worksheets/worksheet-self-signature";
import {
  buildWorksheetSignaturePayload,
  canSignWorksheetVersion,
  worksheetSignatureConfirmation,
  type WorksheetSignatureDecision,
} from "@/lib/worksheets/worksheet-signature";

/**
 * A MUNKALAP ALAIRASA A HELYSZINEN.
 *
 * === EGY GOMB ES EGY MEGEROSITES (Balazs, 2026-09-03 19:42) ===
 *
 * A kepernyo a nevet MEG SEM KERDEZI: nincs nev-mezo. Az elfogadas EGY gomb,
 * utana egy megerosites, ami KIMONDJA, mi tortenik -- nem azt kerdezi, hogy
 * biztos-e. A nevet a kliens tolti ki a bejelentkezett felhasznalobol; a
 * szerver tovabbra is szovegkent varja, tehat ehhez nem kellett szerver-valtozas.
 *
 * AZ ELUTASITAS UTJA MAS, ES SZANDEKOSAN NEM UGYANAZ A GOMB: ott az indok
 * KOTELEZO (Balazs dontese, 2026-08-26), tehat a szerelo ir. Egy indok plusz
 * megerosites.
 *
 * A MEGJEGYZES MEZO MOSTANTOL MINDKET UTON LATSZIK (Balazs dontese, Eldontendo
 * szal, 2026-09-25 11:09): elfogadasnal opcionalis, elutasitasnal kotelezo --
 * ugyanaz a mezo (`note`), csak a feliratozasa es a kotelezettsege maradt
 * kulon. A webes felulet ugyanezt a dontest kapta, egy kulon PR-ben. A KET UT
 * GOMBJA es a megerosito szovege tovabbra sem ugyanaz, csak a mezo lathatosaga
 * lett kozos.
 *
 * A dontesek es a megerosito szovegek a
 * `lib/worksheets/worksheet-signature.ts` modulban allnak, mert ott MERHETOK.
 *
 * === KULON KEPERNYO, ES EZ NEM ELRENDEZESI IZLES ===
 *
 * Ezt a kepernyot a szerelo ODAADJA az ugyfelnek. Ami rajta van, azt az ugyfel
 * olvassa: mit fogad el, mennyiert, es ki irja ala. Ami NINCS rajta -- a
 * tetel-felvitel, a torles, a korabbi verziok, a folytatas-lanc --, azt
 * szandekosan hagytuk le: azok a szerelo munkaeszkozei, es egy atadott
 * telefonon veletlen erintessel is elsulhetnenek.
 *
 * === AMI EZEN A KEPERNYON NINCS: AZ OFFLINE ALAIRAS ===
 *
 * A lap adatlapja MA IS csak halozattal jon be (a `getWorksheet` nem esik
 * gyorsitotarra), tehat az alairas nem szukebb, mint a kepernyo, amirol
 * indul. Ha egyszer a lap adatlapja offline is elerheto lesz, az alairas
 * sorbaallitasa KULON szelet: a `sync_queue` ma `create` muveleteket ismer, es
 * egy kesobb felmeno alairas datuma nem az lenne, amit az ugyfel latott.
 */
export default function WorksheetSignScreen() {
  /**
   * NEM A DONTEST TAROLJUK, HANEM AZT, HOGY NYITVA VAN-E AZ ELUTASITAS UTJA.
   *
   * A dontes a gomb megnyomasakor SZULETIK, es argumentumkent megy vegig a
   * megerositesen es a kuldesen. Egy tarolt dontes-allapot azt engedne meg,
   * hogy a parbeszed nyitva allasa kozben megvaltozzon, amire epp
   * megerositest kertunk.
   */
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const worksheet = useQuery({
    queryKey: ["worksheet", id],
    queryFn: () => getWorksheet(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  /**
   * A NEV A HOROK KOZOTT SZULETIK, NEM A KULDESKOR.
   *
   * Ugyanaz az ertek megy a kepernyore es a szerverre. Ha a kuldes fuggvenye
   * sajat maga olvasna ki ujra, a ket hely kulon romolhatna el -- es az ugyfel
   * MAS nevet latna, mint ami a lapra kerul.
   */
  /**
   * AKI ALAIRHATJA: a lap partnerenek nyilvantartott munkatarsai.
   *
   * A LISTA A SZERVERTOL JON, es vele egyutt az is, MIERT ures, ha ures. Ket
   * kulonbozo ok van (nincs hozzakotott munkatars kontra a partner torzsadata
   * hianyzik), es a teendojuk MAS -- egy nema ures lista mind a kettore
   * raillik, es a szerelo egyiket sem tudja megoldani a helyszinen.
   */
  const signers = useQuery({
    queryKey: ["worksheet-signers", id],
    queryFn: () => listWorksheetSigners(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  /**
   * KIT VALASZTOTT A SZERELO. `null` = "egyik sem", vagyis a nevet beirja --
   * es a lap ezt KIMONDJA (a jelzes a soron tarolodik, nem a kepernyon).
   */
  const [signerUserId, setSignerUserId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  /**
   * AZ ALAIROKOD, amit az UGYFEL ir be. CSAK a listarol valasztott agon kell.
   *
   * INLINE MEZO, NEM FELUGRO ABLAK: ezt a kepernyot a szerelo ODAADJA az
   * ugyfelnek, es ott a kod ugyanazon a lapon all, mint amit az ugyfel epp
   * olvas. Egy kulon parbeszed egy MASODIK, teljes kepernyos ablakot nyitna a
   * mar atadott telefonon.
   */
  const [signatureCode, setSignatureCode] = useState("");
  const signerName =
    signers.data?.items.find((item) => item.id === signerUserId)?.name ??
    typedName.trim();

  /**
   * A DONTES ARGUMENTUMKENT MEGY BE, NEM ALLAPOTBOL OLVASSUK.
   *
   * A megerosito parbeszed egy visszahivast kap, es az akkor fut le, amikor a
   * felhasznalo megnyomja a gombot -- addigra a keperno allapota MAR MAS lehet.
   * Ami ellen ez ved: a szerelo megnyomja az alairast, a parbeszed all, valaki
   * hozzaer az elutasitas gombjahoz, es az elfogadasnak indult muvelet
   * elutasitaskent menne el. Egy argumentum ezt szerkezetileg kizarja.
   */
  /**
   * A SAJAT KOLLEGANK ALAIRASA -- KULON MUTACIO, NEM A MASIK PARAMETERE.
   *
   * Balazs kerese, 2026-09-18 07:01 UTC: "Es az elozo kepernyon utolso gomb
   * Alairom. itt jo lenne ha valami biometrikus azonositas tortenne"
   *
   * KULON UT, mert MAS a torzse (nincs alairo-valasztas, nincs alairokod) es
   * MAS a kapuja (biometria). Egy kozos mutacio harom felteteles agra esne
   * szet, es a ket ut osszecsuszasa epp ott lenne a legdragabb: az egyik
   * tevedes az ugyfel neveben irna ala.
   *
   * A BIOMETRIA HELYI, KENYELMI KAPU: a keszulek tulajdonosat azonositja, nem
   * a szerver fele bizonyit. A kimenetet NEM kuldjuk el es nem taroljuk --
   * egy elmentett "biometriaval alairva" mezo azt a latszatot keltene, hogy
   * ellenoriztuk.
   */
  const signSelf = useMutation({
    mutationFn: async () => {
      const kapu = selfSignatureGate(await unlockWithBiometrics());
      if (!kapu.mayProceed)
        throw new Error(kapu.message ?? "Az azonosítás nem sikerült.");
      /*
        A BEALLITATLAN KESZULEK MONDATA IS MEGJELENIK, holott az alairas megy:
        e nelkul a szerelo azt hinne, hogy azonositas tortent.
      */
      if (kapu.message) setFormError(kapu.message);
      return signWorksheet(id, {
        decision: "ACCEPTED",
        signSelf: true,
        note: note.trim() ? note.trim() : null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
      await queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      router.replace({ pathname: "/worksheets/[id]", params: { id } });
    },
    onError: (cause) =>
      setFormError(
        cause instanceof Error ? cause.message : "Az aláírás nem rögzíthető.",
      ),
  });

  const sign = useMutation({
    mutationFn: async (chosen: WorksheetSignatureDecision) => {
      const built = buildWorksheetSignaturePayload(
        { decision: chosen, note, typedName, signatureCode },
        signerUserId,
      );
      if (!built.ok) throw new Error(built.message);
      return signWorksheet(id, built.payload);
    },
    onSuccess: async () => {
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
      await queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      /**
       * `replace`, nem `push`: az alairas VEGLEGES, tehat a vissza gomb nem
       * vihet ujra erre a kepernyore. A masodik kiserlet ugyis a szerver
       * elutasitasaba futna, csak epp az ugyfel elott.
       */
      router.replace({ pathname: "/worksheets/[id]", params: { id } });
    },
    onError: (cause) =>
      setFormError(
        cause instanceof Error ? cause.message : "Az aláírás nem rögzíthető.",
      ),
  });

  /**
   * A MEGEROSITES. Balazs kerese: az alairas egy gomb plusz egy megerosites.
   *
   * A SZOVEG NEM ITT SZULETIK: a `worksheetSignatureConfirmation` adja, mert
   * ott merheto, hogy tenyleg KIMONDJA, mi tortenik -- egy "Biztos vagy
   * benne?" csak annyit ker, hogy nyomd meg megegyszer.
   *
   * A megse gomb a `cancel` szerep, es a megerosito `destructive`: a
   * rendszer-parbeszedben ez az, ami elvalasztja a ket gombot ranezesre is.
   *
   * ES A HELYI ELLENORZES A PARBESZED ELE KERUL, nem moge: egy indok nelkuli
   * elutasitasnal a szerelo NE azt lassa, hogy megerositette a semmit, aztan
   * kapjon hibat. Ugyanaz a fuggveny mond nemet, ami a kuldeskor is.
   */
  const megerosit = (chosen: WorksheetSignatureDecision) => {
    const built = buildWorksheetSignaturePayload(
      { decision: chosen, note, typedName, signatureCode },
      signerUserId,
    );
    if (!built.ok) {
      setFormError(built.message);
      return;
    }
    setFormError(null);
    const kerdes = worksheetSignatureConfirmation({
      decision: chosen,
      signerName,
    });
    Alert.alert(kerdes.title, kerdes.message, [
      { text: "Mégsem", style: "cancel" },
      {
        text: kerdes.confirmLabel,
        style: "destructive",
        onPress: () => sign.mutate(chosen),
      },
    ]);
  };

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsView) return <Redirect href="/" />;

  const data = worksheet.data;
  const current = data?.currentVersion;
  const signable = current
    ? canSignWorksheetVersion({
        status: current.status,
        worksheetsManage: capabilities.worksheetsManage,
      })
    : false;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>ALÁÍRÁS</Text>

        {worksheet.isPending ? (
          <ActivityIndicator color={tokens.accent} />
        ) : null}

        {worksheet.isError ? (
          <Text style={styles.error}>
            {worksheet.error instanceof Error
              ? worksheet.error.message
              : "A munkalap nem tölthető be."}
          </Text>
        ) : null}

        {data && current ? (
          <>
            <Text style={styles.title}>
              {worksheetLabelOrDraft(current.label)}
            </Text>
            <Text style={styles.subject}>{current.subject}</Text>

            {/*
              AMIT AZ UGYFEL ELFOGAD: a partner, a targy es a BRUTTO osszeg.
              Az osszeg nem diszites: enelkul az alairas arrol szolna, hogy
              "megtortent a munka", nem arrol, hogy mennyiert.
            */}
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>Partner</Text>
                <Text style={styles.value}>{data.customer.displayName}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Helyszín</Text>
                <Text style={styles.value}>{data.department.name}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Tételek</Text>
                <Text style={styles.value}>{current.lines.length} db</Text>
              </View>
              <View style={styles.row}>
                {/*
                  A "FIZETENDO (BRUTTO)" SOR KIKERULT, ES EZ A LEGTOBB
                  MAGYARAZATOT IGENYLO HELY A HAROM KOZUL.

                  Balazs dontese ("B") minden ar-mezore all, es az alairo lap az
                  appban van. DE ITT A VEVO ir ala, nem a szerelo -- ezert
                  kulon kimondom, mit igazol ezutan az alairas:

                  az ELVEGZETT MUNKAT, nem az osszeget.

                  Ez nem atertelmezes, hanem a dontes kovetkezmenye: ugyanabban
                  a korben derult ki, hogy a szamlazasi alap NEM a munkalaprol
                  jon (lasd a worksheet-close-blockers.ts fejlecet). Egy osszeg,
                  amit a vevo alair, de ami nem a szamlazas alapja, tobbet allit,
                  mint amennyi all.

                  HA EZ MEGIS KELL a vevonek, az UJ dontes -- es akkor NEM ez a
                  sor jon vissza, hanem egy kulon, szamlazasi celu kimutatas.
                */}
              </View>
            </View>

            {!signable ? (
              /*
                A NEM-ALAIRHATO ESET KIMONDVA, NEM URES KEPERNYO.
                Aki idaig eljutott, azt egy gomb hozta ide; ha kozben megjott a
                dontes vagy visszanyitottak a lapot, azt MEG KELL MONDANI. Egy
                nema visszairanyitas ugy nezne ki, mintha az app akadt volna
                meg -- az ugyfel elott.
              */
              <View style={styles.card}>
                <Text style={styles.blockedTitle}>
                  Ez a lap most nem írható alá.
                </Text>
                <Text style={styles.muted}>
                  {capabilities.worksheetsManage
                    ? `A lap állapota: ${worksheetStatusLabel[current.status]}. Aláírni csak aláírásra váró lapot lehet: a lezárás az irodából történik.`
                    : "Ehhez írási jog kell a szerviz modulhoz. Szólj az irodának."}
                </Text>
                <Pressable
                  onPress={() =>
                    router.replace({
                      pathname: "/worksheets/[id]",
                      params: { id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryText}>Vissza a munkalapra</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {/*
                  AZ ALAIRO AZ UGYFEL EMBERE (Balazs, 2026-09-04): a szerelo a
                  lap partnerenek nyilvantartott munkatarsai kozul valaszt.

                  A LISTA GOMBOKBOL ALL, NEM LEGORDULOBOL: ezt a kepernyot a
                  szerelo ODAADJA az ugyfelnek, es egy rendszer-legordulo a
                  telefonon egy tovabbi, teljes kepernyos parbeszedet nyit.
                  Nehany nevnel egy sor gomb kevesebb lepes, es latszik is,
                  hany ember kozul lehet valasztani.
                */}
                <Text style={styles.sectionTitle}>Aláíró</Text>
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
                    AZ URES LISTA MEGMONDJA, MIERT. Ket kulonbozo ok van, es a
                    teendojuk MAS -- egy nema ures lista mind a kettore raillik,
                    es a szerelo egyiket sem tudja megoldani a helyszinen. A
                    mondat a SZERVERTOL jon, hogy a ket felulet ugyanazt mondja.
                  */}
                  {signers.data?.emptyReason ? (
                    <Text style={styles.muted}>{signers.data.emptyReason}</Text>
                  ) : null}

                  {/*
                    AZ "EGYIK SEM" AG. Balazs kerte, es NEM kiskapu: ez az az
                    ut, amin a szerelo beirja a nevet -- es a lap KIMONDJA, hogy
                    nem a partner nyilvantartott munkatarsa irta ala. A jelzes a
                    soron tarolodik, nem ezen a kepernyon.
                  */}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSignerUserId(null)}
                    style={[
                      styles.signerOption,
                      signerUserId === null && styles.signerOptionPicked,
                    ]}
                  >
                    <Text style={styles.signer}>Egyik sem</Text>
                  </Pressable>

                  {/*
                    A KOD AZ UGYFELE, ES A VALASZTAS UTAN JON ELO. Amig nincs
                    kivalasztva senki, a mezo ertelmetlen lenne; az "egyik sem"
                    agon pedig NINCS kod, es ez nem kiskapu: ott a lap MAGA
                    MONDJA KI, hogy nem a partner nyilvantartott munkatarsa irta
                    ala.
                  */}
                  {signerUserId !== null ? (
                    <>
                      <Text style={styles.label}>Aláírókód</Text>
                      <TextInput
                        value={signatureCode}
                        onChangeText={setSignatureCode}
                        placeholder="Négy számjegy"
                        placeholderTextColor={tokens.textMuted}
                        keyboardType="number-pad"
                        maxLength={4}
                        secureTextEntry
                        style={styles.input}
                        accessibilityLabel="Aláírókód"
                      />
                      <Text style={styles.muted}>
                        Add oda a telefont az ügyfélnek: a kódot ő írja be.
                      </Text>
                    </>
                  ) : null}

                  {signerUserId === null ? (
                    <>
                      <TextInput
                        value={typedName}
                        onChangeText={setTypedName}
                        placeholder="Az aláíró neve"
                        placeholderTextColor={tokens.textMuted}
                        style={styles.input}
                        accessibilityLabel="Az aláíró neve"
                      />
                      <Text style={styles.muted}>
                        A lapon látszani fog, hogy a nevet te írtad be, és nem a
                        partner nyilvántartott munkatársa írta alá.
                      </Text>
                    </>
                  ) : null}
                </View>

                {formError ? (
                  <Text style={styles.error}>{formError}</Text>
                ) : null}

                {/*
                  A MEGJEGYZES MOSTANTOL MINDKET UTON LATSZIK (Balazs dontese,
                  2026-09-25): elfogadasnal opcionalis, elutasitasnal kotelezo
                  -- ugyanaz a `note` mezo mindket iranyban, csak a
                  kotelezettseget a `buildWorksheetSignaturePayload` donti el a
                  `decision` alapjan, ez a kepernyo csak megjeleniti.
                */}
                <Text style={styles.sectionTitle}>Megjegyzés</Text>
                <View style={styles.card}>
                  <TextInput
                    value={note}
                    onChangeText={(next) => {
                      setNote(next);
                      setFormError(null);
                    }}
                    multiline
                    numberOfLines={3}
                    placeholder="Például: a szivattyú továbbra is zajos"
                    placeholderTextColor={tokens.textMuted}
                    style={[styles.input, styles.noteInput]}
                  />
                  <Text style={styles.muted}>
                    {rejecting
                      ? "A megjegyzés kötelező: enélkül nem derül ki, mit kell javítani."
                      : "Nem kötelező."}
                  </Text>
                </View>

                {rejecting ? (
                  <>
                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => megerosit("REJECTED")}
                      style={[
                        styles.rejectButton,
                        sign.isPending && styles.disabled,
                      ]}
                    >
                      <Text style={styles.submitText}>
                        {sign.isPending ? "Rögzítés…" : "Elutasítás rögzítése"}
                      </Text>
                    </Pressable>

                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => {
                        setRejecting(false);
                        setNote("");
                        setFormError(null);
                      }}
                    >
                      <Text style={styles.secondaryLink}>
                        Mégis aláírja az ügyfél
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    {/*
                      AZ ELFOGADAS: EGY GOMB. Nincs mezo, nincs valaszto -- a
                      megerosites mondja meg, mi tortenik.
                    */}
                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => megerosit("ACCEPTED")}
                      style={[
                        styles.submitButton,
                        sign.isPending && styles.disabled,
                      ]}
                    >
                      <Text style={styles.submitText}>
                        {sign.isPending ? "Rögzítés…" : "Aláírás"}
                      </Text>
                    </Pressable>
                    {/*
                      A HARMADIK GOMB: A SAJAT KOLLEGANK IRJA ALA.

                      A KET FELIRAT KULONBOZIK, es ez nem stilus: a fenti gomb
                      az UGYFEL alairasat rogziti, ez a SAJATUNKAT. A lapon is
                      kulon mondat all majd rola ("Alairta a szolgaltato
                      munkatarsa"), tehat a ket ut nem cserelheto fel.
                    */}
                    <Pressable
                      disabled={sign.isPending || signSelf.isPending}
                      onPress={() => signSelf.mutate()}
                      style={[
                        styles.submitButton,
                        styles.selfSignButton,
                        (sign.isPending || signSelf.isPending) &&
                          styles.disabled,
                      ]}
                    >
                      <Text style={[styles.submitText, styles.selfSignText]}>
                        {signSelf.isPending ? "Azonosítás…" : "Aláírom"}
                      </Text>
                    </Pressable>
                    <Text style={styles.muted}>
                      Ez a gomb a SAJÁT aláírásod: a lapon a szolgáltató
                      munkatársaként fogsz szerepelni, nem az ügyfélként.
                    </Text>
                    <Text style={styles.muted}>
                      Az aláírás végleges: a lap ezután nem írható át, a munka
                      folytatása új lapra kerül.
                    </Text>

                    {/*
                      AZ ELUTASITAS NEM EGYENRANGU GOMB. A helyszinen a lap
                      tulnyomo tobbsege alairassal zarul; ket egyforma gomb
                      egymas mellett a ritka esetet ugyanolyan konnyen
                      elerhetove tenne, mint a gyakorit.
                    */}
                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => {
                        setRejecting(true);
                        setFormError(null);
                      }}
                    >
                      <Text style={styles.secondaryLink}>
                        Az ügyfél nem fogadja el
                      </Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 12 },
    /*
      A SZÍN A TERV SZÜRKÉJE (grey-400 -> t.textMuted), NEM AZ AKCENT. acrobot
      kérése, 2026-09-25 (msg 23917/23921), barracuda mérése alapján: a
      méret/vastagság/betűköz már egyezett a tervvel, csak a szín tért el.
    */
    eyebrow: eyebrowStyle(t, {
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.4,
    }),
    title: { color: t.textPrimary, fontSize: 24, fontWeight: "900" },
    subject: { color: t.textPrimary, fontSize: 16, fontWeight: "700" },
    /*
      A TERV FORRÁSÁBAN "Aláíró" ÉS "Megjegyzés" UGYANAZT A CSS-OSZTÁLYT
      HORDOZZA, MINT A FELSŐ EYEBROW ("ALÁÍRÁS") -- lásd
      `MobileAppScreen.tsx` (figma-telefon-make-12) 1090. és 1125. sora körül:
      mindhárom `text-xs font-semibold text-grey-400 uppercase
      tracking-widest`. A kód eddig sötét, nem nagybetűs, nem ritkított
      szöveget adott -- ezt igazítja a terv szerinti alakra, a `marginTop`
      elrendezési tulajdonságát megtartva.
    */
    sectionTitle: {
      ...eyebrowStyle(t, {
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 1.2,
        textTransform: "uppercase",
      }),
      marginTop: 6,
    },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 16,
      gap: 8,
      padding: 14,
    },
    row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
    label: { color: t.textSecondary, fontSize: 12, fontWeight: "700" },
    value: { color: t.textPrimary, flex: 1, fontSize: 14, textAlign: "right" },
    total: {
      color: t.accent,
      flex: 1,
      fontSize: 18,
      fontWeight: "900",
      textAlign: "right",
    },
    muted: { color: t.textSecondary, fontSize: 12 },
    blockedTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "800" },
    signerOption: {
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 2,
      marginBottom: 8,
      padding: 12,
    },
    signerOptionPicked: { borderColor: t.accent },
    signer: { color: t.textPrimary, fontSize: 18, fontWeight: "800" },
    rejectButton: {
      backgroundColor: t.danger,
      borderRadius: 12,
      marginTop: 4,
      padding: 16,
    },
    secondaryLink: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: "700",
      marginTop: 14,
      textAlign: "center",
      textDecorationLine: "underline",
    },
    input: {
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      color: t.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    noteInput: { minHeight: 80, textAlignVertical: "top" },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
    submitButton: {
      backgroundColor: t.accent,
      borderRadius: 12,
      marginTop: 4,
      padding: 16,
    },
    /**
     * A SAJAT ALAIRAS GOMBJA MASIK SZINU, es ez nem diszites: a ket gomb
     * kozvetlenul egymas alatt all, es a KETTO KOZTI TEVEDES a draga -- az
     * egyik az ugyfel neveben ir ala, a masik a mienkben. UGYANAZ A
     * "MASODLAGOS GOMB" MINTA, MINT A `service-jobs/new.tsx` `secondary`
     * gombja: `surfaceRaised` háttér + `textPrimary` szöveg, NEM
     * `textOnAccent` -- világos módban a `surfaceRaised` fehér, tehát fehér
     * szöveg rajta olvashatatlan lenne.
     */
    selfSignButton: {
      backgroundColor: t.surfaceRaised,
      marginTop: 12,
    },
    selfSignText: { color: t.textPrimary },
    submitText: {
      color: t.textOnAccent,
      fontSize: 16,
      fontWeight: "900",
      textAlign: "center",
    },
    secondaryButton: {
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      marginTop: 4,
      padding: 12,
    },
    secondaryText: {
      color: t.textPrimary,
      fontWeight: "800",
      textAlign: "center",
    },
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.75 },
  });
}
