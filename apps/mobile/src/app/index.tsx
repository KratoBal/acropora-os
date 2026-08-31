import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Redirect, useRouter } from "expo-router";
import * as Updates from "expo-updates";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OrderListCard } from "@/components/orders/OrderListCard";
import { runningVersionLine } from "@/lib/app-version";
import { listUnasOrders } from "@/lib/api/orders";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { UserRole } from "@/lib/auth/types";
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

const NAV_TILE_ROLES: UserRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "WAREHOUSE",
  "VIEWER",
];

interface ModuleCardProps {
  code: string;
  title: string;
  description: string;
  available: boolean;
  enabled: boolean;
  onPress?(): void;
}

export default function HomeScreen() {
  const router = useRouter();
  const { status, user, signOut } = useAuth();
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

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
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

            <View style={styles.modules}>
              <ModuleCard
                code="ES"
                title="Eszközök"
                description="Partnereszközök, QR-azonosítás és hierarchia"
                available={serviceCapabilities.assetsView}
                enabled
                onPress={() => router.push("/assets")}
              />
              <ModuleCard
                code="MU"
                title="Munkalapok"
                description="Kiosztott lapok, tételek és felelősök"
                available={serviceCapabilities.worksheetsView}
                enabled
                onPress={() => router.push("/worksheets")}
              />
              <ModuleCard
                code="RE"
                title="Rendelések"
                description="UNAS rendelések, státuszok és tételek"
                available={capabilities.ordersView}
                enabled
                onPress={() => router.push("/orders")}
              />
              <ModuleCard
                code="BE"
                title="Beszerzés"
                description="Szállítói számlák és bevételezés"
                available={capabilities.purchasingView}
                enabled={false}
              />
              <ModuleCard
                code="TE"
                title="Termékek"
                description="Terméktörzs és készletállapot"
                available={capabilities.productsView}
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
                title="NAV-szinkron"
                description="Bejövő számlák és párosítások"
                available={NAV_TILE_ROLES.includes(user.role)}
                enabled={false}
              />
              <ModuleCard
                code="PA"
                title="Partnerek"
                description="Szerviz partnerek és kapcsolattartók"
                available={capabilities.partnersView}
                enabled
                onPress={() => router.push("/partners")}
              />
            </View>

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
                  <ActivityIndicator color="#52d6c7" />
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
              <ActivityIndicator color="#ff9f92" />
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

function ModuleCard({
  code,
  title,
  description,
  available,
  enabled,
  onPress,
}: ModuleCardProps) {
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
      <View style={[styles.moduleCode, !enabled && styles.moduleCodeDisabled]}>
        <Text
          style={[
            styles.moduleCodeText,
            !enabled && styles.moduleCodeTextDisabled,
          ]}
        >
          {code}
        </Text>
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { gap: 18, padding: 20, paddingBottom: 36 },
  hero: { gap: 10, paddingBottom: 8, paddingTop: 18 },
  heroTopline: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  roleBadge: {
    backgroundColor: "#123f3b",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roleBadgeText: { color: "#6de0ce", fontSize: 11, fontWeight: "800" },
  title: { color: "#f4fbff", fontSize: 30, fontWeight: "900", lineHeight: 36 },
  subtitle: { color: "#9ab8ca", fontSize: 15, lineHeight: 22 },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: { color: "#f4fbff", fontSize: 19, fontWeight: "800" },
  sectionHint: { color: "#6f93a8", fontSize: 12 },
  sectionSubtext: { color: "#6f93a8", fontSize: 12, marginTop: 3 },
  modules: { gap: 10 },
  moduleCard: {
    alignItems: "center",
    backgroundColor: "#0b263d",
    borderColor: "#164668",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    minHeight: 78,
    padding: 14,
  },
  moduleCardDisabled: { opacity: 0.68 },
  moduleCode: {
    alignItems: "center",
    backgroundColor: "#166a7a",
    borderRadius: 12,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  moduleCodeDisabled: { backgroundColor: "#173b55" },
  moduleCodeText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  moduleCodeTextDisabled: { color: "#91adbd" },
  moduleText: { flex: 1, gap: 4 },
  moduleTitle: { color: "#f4fbff", fontSize: 16, fontWeight: "800" },
  moduleDescription: { color: "#86a7ba", fontSize: 12, lineHeight: 17 },
  moduleArrow: { color: "#52d6c7", fontSize: 30, fontWeight: "300" },
  comingSoon: {
    color: "#7798ab",
    fontSize: 10,
    fontWeight: "800",
    maxWidth: 62,
    textAlign: "right",
  },
  ordersSection: { gap: 12, paddingTop: 6 },
  textButton: {
    backgroundColor: "#123f3b",
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  textButtonLabel: { color: "#6de0ce", fontSize: 12, fontWeight: "800" },
  accessCard: {
    backgroundColor: "#3b2b2d",
    borderColor: "#664047",
    borderRadius: 18,
    borderWidth: 1,
    gap: 9,
    padding: 18,
  },
  accessTitle: { color: "#ffd0ca", fontSize: 17, fontWeight: "800" },
  accessText: { color: "#dbaea9", fontSize: 13, lineHeight: 20 },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: "#3b2b2d",
    borderRadius: 14,
    gap: 10,
    padding: 14,
  },
  errorText: { color: "#ffb4ab", fontSize: 13, lineHeight: 19 },
  retryButton: {
    borderColor: "#8c5552",
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  retryText: { color: "#ffd0ca", fontSize: 12, fontWeight: "800" },
  emptyCard: { backgroundColor: "#0b263d", borderRadius: 14, padding: 16 },
  emptyText: { color: "#86a7ba", fontSize: 13 },
  accountCard: {
    alignItems: "center",
    borderTopColor: "#143a55",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 20,
  },
  accountText: { flex: 1, gap: 3 },
  accountName: { color: "#d9edf7", fontSize: 14, fontWeight: "700" },
  accountEmail: { color: "#6f93a8", fontSize: 12 },
  accountHint: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  signOutButton: {
    borderColor: "#5c2b28",
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 108,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  signOutText: {
    color: "#ff9f92",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  pressed: { opacity: 0.7 },
  versionLine: {
    color: "#4d6b7e",
    fontSize: 11,
    marginTop: 14,
    textAlign: "center",
  },
});
