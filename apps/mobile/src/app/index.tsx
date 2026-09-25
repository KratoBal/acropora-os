import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Redirect, useRouter } from "expo-router";
import * as Updates from "expo-updates";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

import { OrderListCard } from "@/components/orders/OrderListCard";
import { runningVersionLine } from "@/lib/app-version";
import { listUnasOrders } from "@/lib/api/orders";
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
import { shouldRegisterPush } from "@/lib/notifications/push-preference";
import { usePushPreference } from "@/lib/notifications/usePushPreference";
import { usePushRegistration } from "@/lib/notifications/usePushRegistration";
import {
  getServiceCapabilities,
  getWebshopCapabilities,
  userRoleLabel,
} from "@/lib/auth/webshop-authorization";

/**
 * KIK LÁTJÁK a NAV csempét. MÉRT lista, nem ízlés: pontosan azok a szerepkörök,
 * amelyeknek a törölt `navView` kulcs `true` volt (a `main` ág állapotából
 * kiolvasva, 2026-08-26). A SALES és a SERVICE nem látta, és ezen a
 * változtatás nem módosít.
 *
 * Azért lista, és nem jogosultság-kulcs, mert a csempe ma nem nyit meg semmit:
 * nincs mögötte hívás, aminek a jogát tükrözhetné.
 */
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

interface ModuleCardProps {
  code: string;
  icon: string;
  title: string;
  description: string;
  available: boolean;
  enabled: boolean;
  onPress?(): void;
}

export default function HomeScreen() {
  const router = useRouter();
  const { status, user, signOut, retryRestore, offline, lastVerifiedAt } =
    useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const isOnline = useIsOnline();
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
  const capabilities = user ? getWebshopCapabilities(user.role) : null;
  const serviceCapabilities = user ? getServiceCapabilities(user.role) : null;
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
  const orders = useQuery({
    queryKey: ["unas-orders", { page: 1, pageSize: 5 }],
    queryFn: () => listUnasOrders(1, 5),
    enabled: Boolean(capabilities?.ordersView && status === "authenticated"),
  });

  if (
    (status !== "authenticated" && status !== "signingOut") ||
    !user ||
    !capabilities ||
    !serviceCapabilities
  ) {
    return <Redirect href="/login" />;
  }

  const signingOut = status === "signingOut";

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
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
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
        <View style={styles.hero}>
          <View style={styles.heroTopline}>
            <Text style={styles.eyebrow}>
              {capabilities.workspace ? "ACROPORA OS" : "FIELD SERVICE"}
            </Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>
                {userRoleLabel(user.role)}
              </Text>
            </View>
          </View>
          <Text style={styles.title}>Szia, {personDisplayName(user)}!</Text>
          <Text style={styles.subtitle}>
            {capabilities.workspace
              ? "A napi működéshez tartozó adatok egy helyen."
              : "Helyszíni eszközök, karbantartások és munkalapok."}
          </Text>
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
              <Text style={styles.sectionHint}>Jogosultságod szerint</Text>
            </View>

            {/*
              A SORREND BALÁZS KÉRÉSE (2026-09-16): szervizes jogosultsággal
              Hibajegyek, Munkalapok, Eszközök, Partnerek.

              ÉS NEM SZEREPKÖRÖNKÉNT MÁS SORREND: a csempék RÖGZÍTETT sora
              változik meg úgy, hogy ez a négy ebben a rendben álljon, a többi
              mögöttük -- egy szerepkörönként újrarendezett képernyő
              követhetetlen lenne annak, aki több szerepet lát.

              AZ "AI" (Anyagigények) CSEMPE 2026-09-23-AN KERULT A Munkalapok
              ES az Eszközök KOZE, es ez a NEGYES sorrendet NEM bontja meg: a
              negy megnevezett csempe egymashoz kepesti sorrendje valtozatlan,
              csak egy uj all kozejuk. A SERVICE szerep ma `SERVICE_MANAGE`
              jogot visel, tehat OTT is latja -- a szervizes tehat MA OTOT lat
              negy helyett, es ez szandekos: a kozos menu-forras dontott igy,
              nem ez a lista (lasd `packages/types/src/navigation.ts`
              `material-requests-pending` tetelet).
            */}
            <View style={styles.modules}>
              <ModuleCard
                code="HJ"
                icon="🎫"
                title="Hibajegyek"
                description="Nyitott jegyek, léptetés és fénykép a helyszínen"
                available={tileVisible("HJ")}
                enabled
                onPress={() => router.push("/service-jobs")}
              />
              <ModuleCard
                code="MU"
                icon="📋"
                title="Munkalapok"
                description="Kiosztott lapok, tételek és felelősök"
                available={tileVisible("MU")}
                enabled
                onPress={() => router.push("/worksheets")}
              />
              {/*
                A LATHATOSAG DURVA KAPUJA A `material-requests-pending` kozos
                menu-tetel (SERVICE_MANAGE), UGYANAZ, mint a Munkalapok -- a
                lista TARTALMANAK finom kapuja (per-felhasznalo kepesseg) a
                kepernyon dol el, nem itt. Lasd a kepernyo sajat fejleceit.
              */}
              <ModuleCard
                code="AI"
                icon="📦"
                title="Anyagigények"
                description="Rád váró anyagigények, beérkezés jelölése"
                available={tileVisible("AI")}
                enabled
                onPress={() => router.push("/material-requests")}
              />
              <ModuleCard
                code="ES"
                icon="🔧"
                title="Eszközök"
                description="Partnereszközök, QR-azonosítás és hierarchia"
                available={tileVisible("ES")}
                enabled
                onPress={() => router.push("/assets")}
              />
              <ModuleCard
                code="AK"
                icon="🐟"
                title="Akváriumok"
                description="Saját és ügyfél akváriumai, méretek és eszközök"
                available={tileVisible("AK")}
                enabled
                onPress={() => router.push("/aquariums")}
              />
              <ModuleCard
                code="RE"
                icon="🛒"
                title="Rendelések"
                description="UNAS rendelések, státuszok és tételek"
                available={tileVisible("RE")}
                enabled
                onPress={() => router.push("/orders")}
              />
              <ModuleCard
                code="BE"
                icon="🧾"
                title="Beszerzés"
                description="Szállítói számlák és bevételezés"
                available={tileVisible("BE")}
                enabled={false}
              />
              <ModuleCard
                code="TE"
                icon="🏷️"
                title="Termékek"
                description="Terméktörzs és készletállapot"
                available={tileVisible("TE")}
                enabled={false}
              />
              {/*
                A LÁTHATÓSÁG ITT NEM JOGOSULTSÁG, és ezért áll szerepkör-listán,
                nem tükör-kulcson. A NAV a szerveren nem EGY jog: a kapcsolat
                beállítása `settings.manage`, az adószám-lekérdezés
                `customers.manage`, a bejövő számlák `purchasing.view`. A tükör
                korábbi `navView` kulcsa egy MODULT nevezett meg, tehát nem volt
                mit tükröznie, és el is tűnt (2026-08-26).

                Amíg a képernyő nem létezik, ez a csempe csak annyit mond, hogy
                ez a modul következik -- és pontosan annak látszik, akinek eddig
                is. Amikor megépül, a hívásához tartozó kulcs dönt majd róla (a
                bejövő számlákhoz `purchasingView`), és akkor a listának itt nem
                lesz többé dolga.
              */}
              <ModuleCard
                code="NAV"
                icon="🔄"
                title="NAV-szinkron"
                description="Bejövő számlák és párosítások"
                available={tileVisible("NAV")}
                enabled={false}
              />
              <ModuleCard
                code="PA"
                icon="🤝"
                title="Partnerek"
                description="Szerviz partnerek és kapcsolattartók"
                available={tileVisible("PA")}
                enabled
                onPress={() => router.push("/partners")}
              />
            </View>

            {lathatoCsempek === 0 ? (
              /*
                NULLA CSEMPE: KI KELL MONDANI. A visszaeses kiesesevel (2026-09-02)
                eloall egy allapot, ami eddig nem letezett: a szerver nem kuldott
                menut, tehat egyetlen csempe sincs. Egy URES szakasz a "Modulok"
                cim alatt betoltesi hibanak latszik, es a felhasznalo nem tudja,
                mit kezdjen vele.

                A DONTES INDOKA epp az volt, hogy a hiba legyen HANGOS a csendes
                visszaeses helyett -- egy nema ures felulet viszont nem hangos,
                csak zavaro.

                ES AMI EBBOL A LEGFONTOSABB (acrobot erve, 2026-09-02): egy URES
                kezdolap PONTOSAN UGY NEZ KI, mint egy jogosultsag nelkuli
                felhasznalo kezdolapja. A helyszinen allo szerelo nem tudna
                megkulonboztetni a kettot, es azt hinne, elvettek a jogait. Ezert
                mondja ki a szoveg, hogy NEM a jogosultsagrol van szo.
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
                  menut is ujra lekeri -- munkamenet elvesztese nelkul. A
                  helyszinen allo szerelonek a kijelentkezes valodi koltseg.
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
              A HELYSZIN-LETOLTO A MODULOK ALATT, ES CSAK SZERVIZES SZEMNEK.

              Balazs kerese, 2026-09-21: a kollega a pinceben dolgozik, es ma
              minden eszkoz adatlapjat kezzel kell megnyitnia, MIELOTT lemegy.
              A gomb a fokepernyon all, mert a szerelo innen indul -- es itt fut
              ma is az urlap-elotoltes (`useFormCachePrefetch`), ugyanezert.
            */}
            {serviceCapabilities.assetsView ? <HelyszinLetolto /> : null}

            {capabilities.ordersView ? (
              <View style={styles.ordersSection}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>
                      Legutóbbi rendelések
                    </Text>
                    <Text style={styles.sectionSubtext}>
                      {orders.data
                        ? `${orders.data.pagination.totalItems.toLocaleString("hu-HU")} rendelés összesen`
                        : "Valódi Acropora OS-adatok"}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Összes rendelés megnyitása"
                    onPress={() => router.push("/orders")}
                    style={({ pressed }) => [
                      styles.textButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.textButtonLabel}>Összes</Text>
                  </Pressable>
                </View>

                {orders.isPending ? (
                  <ActivityIndicator color={tokens.accent} />
                ) : null}
                {orders.isError ? (
                  <ErrorCard
                    message={
                      orders.error instanceof Error
                        ? orders.error.message
                        : "A rendelések betöltése nem sikerült."
                    }
                    onRetry={() => void orders.refetch()}
                  />
                ) : null}
                {orders.data?.items.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyText}>
                      Még nincs szinkronizált webshop rendelés.
                    </Text>
                  </View>
                ) : null}
                {orders.data?.items.slice(0, 3).map((order) => (
                  <OrderListCard
                    key={order.id}
                    order={order}
                    onPress={() =>
                      router.push({
                        pathname: "/orders/[id]",
                        params: { id: order.id },
                      })
                    }
                  />
                ))}
              </View>
            ) : null}
          </>
        )}

        <View style={styles.accountCard}>
          {/*
            A NEVEDRE KOPPINTVA NYÍLNAK A BEÁLLÍTÁSOK. A gazda kérése szerint
            innen érhető el, és itt is van a helye: ez az egyetlen hely a
            nyitólapon, ami rólad szól, nem a munkáról.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Beállítások megnyitása"
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [
              styles.accountText,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.accountName}>{personDisplayName(user)}</Text>
            <Text style={styles.accountEmail}>{user.email}</Text>
            <Text style={styles.accountHint}>Beállítások ›</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kijelentkezés"
            accessibilityState={{ disabled: signingOut }}
            disabled={signingOut}
            onPress={() => void signOut()}
            style={({ pressed }) => [
              styles.signOutButton,
              (pressed || signingOut) && styles.pressed,
            ]}
          >
            {signingOut ? (
              <ActivityIndicator color={tokens.danger} />
            ) : (
              <Text style={styles.signOutText}>Kijelentkezés</Text>
            )}
          </Pressable>
        </View>

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
    </SafeAreaView>
  );
}

/**
 * SAJÁT `useAppTheme()`-HÍVÁS: ez a segédkomponens a fő függvényen KÍVÜL áll,
 * tehát nem éri el annak per-render `styles` állandóját -- ugyanaz a minta,
 * mint a `worksheets/new.tsx` `Section`/`FieldError` segédkomponensei.
 */
function ModuleCard({
  icon,
  title,
  description,
  available,
  enabled,
  onPress,
}: ModuleCardProps) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (!available) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${enabled ? " megnyitása" : ", következő ütem"}`}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.moduleCard,
        !enabled && styles.moduleCardDisabled,
        pressed && styles.pressed,
      ]}
    >
      {/*
        A BETŰKÓD HELYETT A TERV SZERINTI IKON (Balázs kérése, 2026-09-25
        18:23, exchange/figma-telefon-make-12/src/MobileAppScreen.tsx
        264-269. sor): a hat megnevezett modul emojija onnan jön betűre
        egyezően. A négy, a tervben NEM szereplő modul (Rendelések,
        Beszerzés, Termékek, NAV-szinkron) saját, a témájukhoz illő emojit
        kapott, ugyanabban a stílusban. A DOBOZ ÉS A HALVÁNYÍTÁS
        VÁLTOZATLAN: a `moduleCardDisabled` `opacity`-je a teljes csempét
        (az ikont is) halványítja, ugyanúgy, ahogy eddig a betűkódot.
      */}
      <View style={[styles.moduleCode, !enabled && styles.moduleCodeDisabled]}>
        <Text style={styles.moduleIconText}>{icon}</Text>
      </View>
      <View style={styles.moduleText}>
        <Text style={styles.moduleTitle}>{title}</Text>
        <Text style={styles.moduleDescription}>{description}</Text>
      </View>
      <Text style={enabled ? styles.moduleArrow : styles.comingSoon}>
        {enabled ? "›" : "Következő ütem"}
      </Text>
    </Pressable>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry(): void }) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={styles.retryButton}
      >
        <Text style={styles.retryText}>Újrapróbálás</Text>
      </Pressable>
    </View>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- Figma 12.
 * kör, a maradék telefonos képernyők átültetése (az Eszközök #1087/#1089
 * és a Munkalapok #1124-#1126 mintáját követve): ez a képernyő eddig saját,
 * fix sötét hexekkel élt.
 *
 * A "BANNER"/"HIBA" DOBOZOK (`offlineBanner`, `accessCard`, `errorCard`) A
 * MEGFELELŐ `*Soft`+SZEMANTIKUS PÁRT KAPJÁK, ugyanaz a minta, mint a
 * `components/offline/OfflineNoticeCard.tsx`-ben: `warningSoft`+`warning` a
 * figyelmeztető sávnak, `dangerSoft`+`danger` a jogosultsági/hiba-
 * kártyáknak.
 *
 * A RENDELÉSEK SZAKASZ (`ordersSection` és az alatta állók) STÍLUSA IS
 * TÉMÁSÍTVA VAN, DE A TARTALMA/MŰKÖDÉSE NEM VÁLTOZOTT: a Figma 12. kör
 * brief-je szerint "a webshop rendelései NEM része a körnek" -- ez a
 * `/orders/*` KÜLÖN képernyőire vonatkozik, nem erre a kezdőlapba ágyazott,
 * apró előnézetre, aminek muszáj témát kapnia, különben világos módban a
 * kezdőlap egy sötét foltot mutatna.
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
      marginBottom: 16,
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
    container: { gap: 18, padding: 20, paddingBottom: 36 },
    hero: { gap: 10, paddingBottom: 8, paddingTop: 18 },
    heroTopline: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    eyebrow: {
      color: t.accent,
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 1.5,
    },
    roleBadge: {
      backgroundColor: t.accentSoft,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    roleBadgeText: { color: t.accentSoftText, fontSize: 11, fontWeight: "800" },
    title: {
      color: t.textPrimary,
      fontSize: 30,
      fontWeight: "900",
      lineHeight: 36,
    },
    subtitle: { color: t.textSecondary, fontSize: 15, lineHeight: 22 },
    sectionHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    sectionTitle: { color: t.textPrimary, fontSize: 19, fontWeight: "800" },
    sectionHint: { color: t.textMuted, fontSize: 12 },
    sectionSubtext: { color: t.textMuted, fontSize: 12, marginTop: 3 },
    /**
     * KÉT OSZLOP, A TERV SZERINT (Balázs kérdése, 2026-09-25 18:25, ugyanaz
     * a képernyőfotó-kör, mint az ikonoké): a `justifyContent: "space-
     * between"` osztja el a sor két csempéjét, NEM egy vízszintes `gap` --
     * a `gap` és a százalékos `width` együtt Yoga alatt könnyen túlcsordul
     * (48% + 48% + gap > 100%), és a második csempét lelöki a következő
     * sorba. A `rowGap` (a SOROK közti függőleges tér) ezt a kockázatot nem
     * hordozza, mert nem a szélesség-számításba megy bele.
     *
     * PÁRATLAN CSEMPESZÁMNÁL AZ UTOLSÓ FÉL SZÉLESSÉGŰ MARAD, NEM NYÚLIK KI:
     * a csempe SAJÁT `width: "48%"`-a rögzített, nem `flex: 1`, tehát egy
     * pár nélkül maradt utolsó csempe a `space-between` mellett egyszerűen
     * a sor elején áll, üres hellyel mellette -- nem tölti ki a sort.
     */
    modules: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 10,
    },
    /**
     * FÜGGŐLEGES CSEMPE, A TERV SZERINT: felül az ikon, alatta a cím és a
     * leírás, legalul a nyíl (vagy a "Következő ütem" felirat). Az
     * `alignItems: "stretch"` (a React Native alapértelmezése, itt
     * KIMONDVA, mert erre épül a lenti `moduleText: { flex: 1 }`) teszi,
     * hogy a szöveg-blokk és a nyíl a TELJES kártyaszélességet kapja, az
     * ikon-doboz sajátmagasságát/szélességét pedig a rögzített `width`/
     * `height` védi a nyújtástól.
     */
    moduleCard: {
      alignItems: "stretch",
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: "column",
      gap: 8,
      padding: 14,
      width: "48%",
    },
    moduleCardDisabled: { opacity: 0.68 },
    moduleCode: {
      alignItems: "center",
      backgroundColor: t.accent,
      borderRadius: 12,
      height: 46,
      justifyContent: "center",
      width: 46,
    },
    moduleCodeDisabled: { backgroundColor: t.border },
    moduleIconText: { fontSize: 22, textAlign: "center" },
    /**
     * A `flex: 1` TOLJA A NYILAT/FELIRATOT A KÁRTYA ALJÁRA: ha egy sor
     * másik csempéje magasabb (hosszabb leírás miatt), a sor mindkét
     * csempéje ugyanolyan magasra nyúlik (RN alapértelmezett `stretch`), és
     * ez a blokk issza fel a többletmagasságot -- a nyíl emiatt marad
     * mindig legalul, nem a leírás alján lebegve.
     */
    moduleText: { flex: 1, gap: 4 },
    moduleTitle: { color: t.textPrimary, fontSize: 16, fontWeight: "800" },
    moduleDescription: { color: t.textSecondary, fontSize: 12, lineHeight: 17 },
    moduleArrow: { color: t.accent, fontSize: 22, fontWeight: "300" },
    comingSoon: { color: t.textMuted, fontSize: 10, fontWeight: "800" },
    ordersSection: { gap: 12, paddingTop: 6 },
    textButton: {
      backgroundColor: t.accentSoft,
      borderRadius: 10,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    textButtonLabel: {
      color: t.accentSoftText,
      fontSize: 12,
      fontWeight: "800",
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
    errorCard: {
      alignItems: "flex-start",
      backgroundColor: t.dangerSoft,
      borderRadius: 14,
      gap: 10,
      padding: 14,
    },
    errorText: { color: t.danger, fontSize: 13, lineHeight: 19 },
    retryButton: {
      borderColor: t.danger,
      borderRadius: 9,
      borderWidth: 1,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    retryText: { color: t.danger, fontSize: 12, fontWeight: "800" },
    // A gomb a kartyan BELUL all, ezert kap sajat felso margot -- a stilust magat
    // a rendeles-hiba kartyaval OSZTJA, hogy a ket ujraprobalas ugyanugy nezzen ki.
    retryInCard: { alignSelf: "flex-start", marginTop: 12 },
    emptyCard: { backgroundColor: t.surface, borderRadius: 14, padding: 16 },
    emptyText: { color: t.textSecondary, fontSize: 13 },
    accountCard: {
      alignItems: "center",
      borderTopColor: t.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: 12,
      justifyContent: "space-between",
      marginTop: 8,
      paddingTop: 20,
    },
    accountText: { flex: 1, gap: 3 },
    accountName: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    accountEmail: { color: t.textSecondary, fontSize: 12 },
    accountHint: {
      color: t.accent,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 4,
    },
    signOutButton: {
      borderColor: t.danger,
      borderRadius: 10,
      borderWidth: 1,
      minWidth: 108,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    signOutText: {
      color: t.danger,
      fontSize: 12,
      fontWeight: "800",
      textAlign: "center",
    },
    pressed: { opacity: 0.7 },
    versionLine: {
      color: t.textMuted,
      fontSize: 11,
      marginTop: 14,
      textAlign: "center",
    },
  });
}
