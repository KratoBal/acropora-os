import Constants from "expo-constants";
import { Redirect, useRouter, type Href } from "expo-router";
import * as Updates from "expo-updates";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

import { BottomNav } from "@/components/home/BottomNav";
import { ModuleTile } from "@/components/home/ModuleTile";
import { useNavigationCounters } from "@/components/home/useNavigationCounters";
import { tileBadge } from "@/lib/navigation/counters";
import { runningVersionLine } from "@/lib/app-version";
import { HOME_MODULES } from "@/lib/home/modules";
import {
  defaultPresetFor,
  HOME_PRESETS,
  homeModules,
} from "@/lib/home/presets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { describeOfflineSession } from "@/lib/auth/offline-session-notice";
import { useIsOnline } from "@/lib/offline/connectivity";
import { HelyszinLetolto } from "@/components/offline/HelyszinLetolto";
import { useFormCachePrefetch } from "@/lib/offline/use-form-cache-prefetch";
import { useQueueBacklog } from "@/lib/offline/use-queue-backlog";
import { useQueueDrain } from "@/lib/offline/use-queue-drain";
import {
  servedTileIds,
  tileVisible as tileVisibleFor,
  type TileCode,
} from "@/lib/auth/tile-visibility";
import { personDisplayName } from "@/lib/auth/person-name";
import { initialsFor } from "@/lib/aquariums/aquarium-avatar";
import { shouldRegisterPush } from "@/lib/notifications/push-preference";
import { usePushPreference } from "@/lib/notifications/usePushPreference";
import { usePushRegistration } from "@/lib/notifications/usePushRegistration";
import {
  getServiceCapabilities,
  getWebshopCapabilities,
} from "@/lib/auth/webshop-authorization";

/**
 * MELYIK BUILD FUT, ÉS MIÉRT PONT EBBŐL A MEZŐBŐL.
 *
 * A `Constants.platform.ios.buildNumber` a beépített `Info.plist` értéke, és a
 * csomag saját dokumentációja mondja ki, hogy ez „soha nem változik egy adott
 * natív binárisnál", szemben az `expoConfig.ios.buildNumber` mezővel, amit egy
 * éteren érkezett frissítés FELÜLÍRHAT.
 *
 * Vagyis a két mező pont akkor térne el, amikor a felirat a legfontosabb: egy
 * letöltött frissítés alatt a manifest szerinti szám már a frissítésé lenne, a
 * bináris viszont a régi. Az a felirat nem hazudna, csak mást jelölne, mint amit
 * az olvasója hisz -- ezért a NATÍV érték kerül a képernyőre.
 */
function nativeBuildNumber(): string | null {
  const ios = Constants.platform?.ios?.buildNumber;
  if (ios) return ios;
  const android = Constants.platform?.android?.versionCode;
  return android == null ? null : String(android);
}

export default function HomeScreen() {
  const router = useRouter();
  const { status, user, retryRestore, offline, lastVerifiedAt } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const isOnline = useIsOnline();
  // the tile numbers (card 4a6813db), before any early return
  const counters = useNavigationCounters();
  /**
   * A SOR KIURITESE ITT INDUL, mert ez az elso kepernyo, amit a kollega lat.
   * A hook maga dont: csak online fut, es csak egyszer egyidoben.
   *
   * A TOBBI HOOK MELLE KERULT, a korai visszateresek ELE: a React szabalya
   * szerint minden renderelesben ugyanabban a sorrendben kell lefutniuk, es a
   * `status !== "authenticated"` ag kulonben kihagyna.
   */
  const queueMessage = useQueueDrain(isOnline);
  /**
   * ES AMI A FUTAS UTAN IS MARAD. A fenti uzenet egy FUTASROL szol, es eltunik;
   * ez az ALLAPOTROL, es epp akkor a legfontosabb, amikor nincs halozat, tehat
   * futas sincs, amirol beszelni lehetne. A kiurites uzenete a fuggoseg: utana
   * a szamok masok.
   */
  const backlogMessage = useQueueBacklog(queueMessage);
  /*
   * Once the session exists, and never before: registering a device is only
   * meaningful for a known colleague, and the server takes the owner from the
   * session.
   *
   * ÉS A KAPCSOLÓ ÁLLÁSA IS SZÁMÍT. Amíg a beállítás töltődik, nem
   * regisztrálunk: a beállítatlan és a még be nem töltött állapot ugyanúgy
   * `null`, és a kettőt összemosva egy kikapcsolt készülék a következő
   * indításnál csendben visszakapcsolná magát.
   */
  const push = usePushPreference();
  usePushRegistration(
    !push.loading &&
      shouldRegisterPush({
        authenticated: status === "authenticated",
        preference: push.preference,
      }),
  );
  const capabilities = user ? getWebshopCapabilities(user) : null;
  const serviceCapabilities = user ? getServiceCapabilities(user) : null;
  /**
   * AZ ESZKOZ-URLAP KET LISTAJA A KESZULEKRE, AMIG MEG VAN TEREO.
   *
   * A sor kiuritese mellett a helye, es ugyanazert: ez az elso kepernyo, amit a
   * kollega lat. A masolat eddig CSAK az urlap megnyitasakor keletkezett, tehat
   * aki sosem nyitotta meg jellel, annak a pinceben ures volt a partnerlista --
   * es a felvitelhez a partner KOTELEZO.
   *
   * A korai visszateres ELE kerult, a tobbi hook melle: a `status` szerinti ag
   * kulonben kihagyna, es a hookok sorrendjenek minden renderelesben azonosnak
   * kell lennie.
   */
  useFormCachePrefetch({
    online: isOnline,
    authenticated: status === "authenticated",
    assetsManage: Boolean(serviceCapabilities?.assetsManage),
  });
  const servedIds = servedTileIds(user);
  /**
   * A SZERVER DONT, ES CSAK HA HALLGAT, AKKOR A SAJAT TABLA.
   *
   * A `fallback` nem masodik velemeny: pontosan akkor jut szohoz, amikor a
   * szerver egyaltalan nem kuldott menut. Amig kuld, az itteni tablak nem
   * befolyasolnak semmit a kezdokepernyon.
   */
  const tileVisible = (code: TileCode) => tileVisibleFor(servedIds, code);
  // HANY CSEMPE LATSZIK. A visszaeses kiesesevel eloall egy allapot, ami eddig
  // nem letezett: a szerver nem kuldott menut, tehat NULLA csempe van. Ezt a
  // kepernyonek ki kell mondania -- egy ures szakasz cim alatt ugy nez ki, mint
  // egy betoltesi hiba, es a felhasznalo nem tudja, mit kezdjen vele.
  const lathatoCsempek = servedIds.size;
  if (
    (status !== "authenticated" && status !== "signingOut") ||
    !user ||
    !capabilities ||
    !serviceCapabilities
  ) {
    return <Redirect href="/login" />;
  }

  const preset = HOME_PRESETS[defaultPresetFor(user.role)];
  const tiles = homeModules(preset, tileVisible);

  /**
   * AZ OFFLINE SAV A KEZDOLAP TETEJEN.
   *
   * `null`, ha az app ONLINE indult -- akkor a kepernyo valtozatlan. Ha
   * mindig kiirnank, a kollega harmadszorra nem olvasna el, es akkor a VALODI
   * eset is elveszne.
   */
  const offlineNotice = describeOfflineSession({
    offline,
    lastVerifiedAt,
    now: new Date(),
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {queueMessage ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerBody}>{queueMessage}</Text>
          </View>
        ) : null}
        {backlogMessage ? (
          /*
            A SAV MOSTANTOL AJTO IS. Amig csak SZAMOLT, egy megallt felvitel
            zsakutca volt: a mondat kimondta, hogy segitseg kell, es nem volt
            hova menni vele.
          */
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Feltöltésre váró felvitelek megnyitása"
            onPress={() => router.push("/queue")}
            style={({ pressed }) => [
              styles.offlineBanner,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.offlineBannerBody}>{backlogMessage}</Text>
            <Text style={styles.offlineBannerLink}>
              Koppints: mi vár, és mi akadt el
            </Text>
          </Pressable>
        ) : null}
        {offlineNotice ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerTitle}>{offlineNotice.title}</Text>
            <Text style={styles.offlineBannerBody}>{offlineNotice.body}</Text>
          </View>
        ) : null}
        {/*
          THE HEADER IS DRAWN IN THE CONTENT, NOT BY THE NAVIGATOR (Figma 412:3,
          mobile Home V1): the eyebrow, the greeting, and the initials at the
          right, which open the profile. The navigator's header is hidden for
          this screen in `_layout.tsx`, so the old gear button went with it;
          the profile is also one tap away in the bottom bar.
        */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>
              {capabilities.workspace ? "ACROPORA OS" : "FIELD SERVICE"}
            </Text>
            <Text style={styles.title}>Szia, {personDisplayName(user)}!</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profil megnyitása"
            hitSlop={8}
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [
              styles.avatarCircle,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.avatarText}>
              {initialsFor(personDisplayName(user))}
            </Text>
          </Pressable>
        </View>
        {/*
          THE VIEW, NAMED BUT NOT YET SWITCHABLE. Phase 1 takes the view from
          the role alone (`defaultPresetFor`); the chip that switches it, and
          the choice kept on the device, come in phase 2. Until then it is a
          label, not a button, so it promises nothing it cannot do.
        */}
        <View style={styles.presetChip}>
          <Text style={styles.presetChipText}>{preset.label}</Text>
        </View>

        {!capabilities.workspace && !serviceCapabilities.workspace ? (
          <View style={styles.accessCard}>
            <Text style={styles.accessTitle}>
              Ehhez a munkaterülethez nincs hozzáférésed
            </Text>
            <Text style={styles.accessText}>
              A Webshop Manager mobilnézetet az OWNER, ADMIN, MANAGER, SALES,
              WAREHOUSE és VIEWER szerepkörök használhatják. A Szerviz
              munkaterületet a SERVICE szerepkör is eléri. A szerver minden
              adatlekérést külön is jogosultság alapján ellenőriz.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Modulok</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Összes modul megnyitása"
                hitSlop={8}
                onPress={() => router.push("/modulok")}
              >
                <Text style={styles.sectionLink}>Összes</Text>
              </Pressable>
            </View>

            {/*
              THE VIEW DECIDES THE ORDER; THE SERVER DECIDES WHAT IS THERE.
              `homeModules` keeps only the view's modules whose navigation
              entry the server served and that have a screen, at most six.
              A module outside the view is still under Modulok.
            */}
            <View style={styles.modules}>
              {tiles.map((code) => {
                const entry = HOME_MODULES[code];
                return (
                  <ModuleTile
                    key={code}
                    module={entry}
                    badge={tileBadge(code, counters)}
                    onPress={() => {
                      if (entry.route) router.push(entry.route as Href);
                    }}
                  />
                );
              })}
            </View>

            {lathatoCsempek === 0 ? (
              /*
                NULLA CSEMPE: KI KELL MONDANI. A visszaeses kiesesevel (2026-09-02)
                eloall egy allapot, ami eddig nem letezett: a szerver nem kuldott
                menut, tehat egyetlen csempe sincs. Egy URES szakasz a "Modulok"
                cim alatt betoltesi hibanak latszik, es a felhasznalo nem tudja,
                mit kezdjen vele.

                ES AMI EBBOL A LEGFONTOSABB (acrobot erve, 2026-09-02): egy URES
                kezdolap PONTOSAN UGY NEZ KI, mint egy jogosultsag nelkuli
                felhasznalo kezdolapja. Ezert mondja ki a szoveg, hogy NEM a
                jogosultsagrol van szo.
              */
              <View style={styles.accessCard}>
                <Text style={styles.accessTitle}>
                  Nincs megjeleníthető modul
                </Text>
                <Text style={styles.accessText}>
                  A kiszolgáló nem küldött menüt ehhez a munkamenethez. Ez nem a
                  jogosultságaiddal függ össze: próbáld újra, és ha így marad,
                  szólj a rendszergazdának.
                </Text>
                {/*
                  UJRAPROBALAS, NEM KI- ES VISSZAJELENTKEZES. A `retryRestore`
                  ugyanazt futtatja le, ami indulaskor fut (`/auth/me`), tehat a
                  menut is ujra lekeri -- munkamenet elvesztese nelkul.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Menü újrakérése"
                  style={[styles.retryButton, styles.retryInCard]}
                  onPress={retryRestore}
                >
                  <Text style={styles.retryText}>Újrapróbálás</Text>
                </Pressable>
              </View>
            ) : null}

            {/*
              A HELYSZIN-LETOLTO A MODULOK ALATT, ES CSAK SZERVIZES SZEMNEK
              (Balazs kerese, 2026-09-21): a szerelo innen indul, mielott a
              pincebe lemegy.
            */}
            {serviceCapabilities.assetsView ? <HelyszinLetolto /> : null}
          </>
        )}

        {/*
          MELYIK KÓD FUT ÉPPEN. Egy sor, a lap alján, és nem kényelmi funkció:
          2026-08-26 este egy kört vitt el, hogy nem lehetett eldönteni, egy
          éteren küldött javítás megérkezett-e a készülékre.
        */}
        <Text style={styles.versionLine}>
          {runningVersionLine({
            buildNumber: nativeBuildNumber(),
            isEmbeddedLaunch: Updates.isEmbeddedLaunch,
            updateId: Updates.updateId,
            updateCreatedAt: Updates.createdAt,
          })}
        </Text>
      </ScrollView>
      <BottomNav active="home" />
    </SafeAreaView>
  );
}

/**
 * THE COLOURS COME FROM THE SHARED `useAppTheme()`. The banners and the
 * access card keep their `*Soft` plus semantic pairs (`warningSoft`/`warning`,
 * `dangerSoft`/`danger`), as in `components/offline/OfflineNoticeCard.tsx`.
 * The header, chip and section follow Figma 412:3.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    offlineBanner: {
      backgroundColor: t.warningSoft,
      borderColor: t.warning,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
    },
    offlineBannerTitle: {
      color: t.warning,
      fontSize: 15,
      fontWeight: "700",
      marginBottom: 4,
    },
    offlineBannerBody: { color: t.textSecondary, fontSize: 13, lineHeight: 19 },
    offlineBannerLink: {
      color: t.accent,
      fontSize: 12,
      fontWeight: "800",
      marginTop: 6,
    },
    container: { gap: 16, padding: 20, paddingBottom: 28 },
    header: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      paddingTop: 8,
    },
    headerText: { flex: 1, gap: 4 },
    eyebrow: {
      color: t.accent,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.2,
    },
    title: {
      color: t.textPrimary,
      fontSize: 26,
      fontWeight: "700",
      lineHeight: 32,
    },
    avatarCircle: {
      alignItems: "center",
      backgroundColor: t.accentSoft,
      borderRadius: 22,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    avatarText: { color: t.accentSoftText, fontSize: 15, fontWeight: "700" },
    presetChip: {
      alignSelf: "flex-start",
      backgroundColor: t.accentSoft,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    presetChipText: {
      color: t.accentSoftText,
      fontSize: 13,
      fontWeight: "700",
    },
    sectionHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
    },
    sectionTitle: { color: t.textPrimary, fontSize: 17, fontWeight: "700" },
    sectionLink: { color: t.accent, fontSize: 14, fontWeight: "600" },
    /**
     * TWO TILES TO A ROW: `space-between` spreads them and each tile is 48%
     * wide. A horizontal `gap` next to percentage widths overflows under Yoga
     * and pushes the second tile to the next row; `rowGap` does not.
     */
    modules: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 12,
    },
    accessCard: {
      backgroundColor: t.dangerSoft,
      borderColor: t.danger,
      borderRadius: 18,
      borderWidth: 1,
      gap: 9,
      padding: 18,
    },
    accessTitle: { color: t.danger, fontSize: 17, fontWeight: "800" },
    accessText: { color: t.textSecondary, fontSize: 13, lineHeight: 20 },
    retryButton: {
      borderColor: t.danger,
      borderRadius: 9,
      borderWidth: 1,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    retryText: { color: t.danger, fontSize: 12, fontWeight: "800" },
    retryInCard: { alignSelf: "flex-start", marginTop: 12 },
    pressed: { opacity: 0.7 },
    versionLine: {
      color: t.textMuted,
      fontSize: 12,
      marginTop: 14,
      textAlign: "center",
    },
  });
}
