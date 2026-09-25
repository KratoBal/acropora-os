import "react-native-gesture-handler";

import { QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { LockedScreen } from "@/components/LockedScreen";
import { RestoringScreen } from "@/components/RestoringScreen";
import { environment } from "@/config/env";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { foregroundNotificationBehavior } from "@/lib/notifications/push-foreground";
import { usePushNavigation } from "@/lib/notifications/usePushNavigation";
import { queryClient } from "@/lib/query-client";

/**
 * AZ ERTESITES AKKOR IS LATSZIK, HA AZ APP NYITVA VAN.
 *
 * MODUL SZINTEN, NEM A KOMPONENSBEN, es ez nem stilus: a rendszer akkor kerdez
 * ra a viselkedesre, amikor az ertesites MEGERKEZIK. Egy `useEffect`-ben
 * regisztralva a horog a legelso ertesitesrol lekesne -- pontosan arrol,
 * amelyik az appot eppen eleri.
 *
 * A DONTES a `lib/notifications/push-foreground.ts`-ben all, mert ott MERHETO;
 * ez a sor csak atadja. Kezelo NELKUL a konyvtar alapertelmezese az, hogy NEM
 * mutatja meg az ertesitest (a sajat forrasa mondja ki), tehat ez a nehany sor
 * a kulonbseg a kozott, hogy a kollega ertesul-e egy kiosztott munkalaprol,
 * amig az appot hasznalja.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => foregroundNotificationBehavior(),
});

export default function RootLayout() {
  // Checked before anything else mounts. A missing or unreadable server
  // address used to throw while `config/env.ts` was being imported, which
  // killed the app on launch with nothing on screen to explain it. Now it
  // is a state the app can render, and the person holding the phone can
  // read what is wrong instead of watching it disappear.
  if (!environment.ok) {
    return (
      <>
        <StatusBar style="light" />
        <RestoringScreen
          networkError={false}
          onRetry={() => undefined}
          configProblems={environment.problems}
        />
      </>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * While the app is restoring the session (SecureStore + `/auth/me`), the
 * route Stack is not mounted at all — neither `login` nor `index` renders
 * — so a valid token never causes a visible flash of the login screen.
 * `index.tsx` and `login.tsx` each redirect to the other when the auth
 * state doesn't match what they require, so the Stack itself always
 * declares both routes once mounted.
 */
function RootNavigator() {
  const {
    status,
    user,
    lockReason,
    restoreNetworkError,
    retryRestore,
    unlock,
    signOut,
  } = useAuth();

  /**
   * A KOPPINTAS AZ ERTESITESEN MEGNYITJA A MUNKALAPOT.
   *
   * ITT ALL, A KORAI VISSZATERESEK ELOTT, es ez nem elrendezes: a `restoring`
   * es a `locked` ag a Stack HELYETT rajzol, tehat ha a horog azok utan allna,
   * a React szabalya szerint borulna a horog-sorrend -- es epp abban a ket
   * allapotban NEM futna le, amelyikbol a leggyakoribb valos eset indul (a
   * telefon a zsebben, koppintas a zarolt kepernyorol).
   *
   * A horog maga tudja, hogy ilyenkor nem szabad navigalni, ES azt is, hogy a
   * valaszt nem szabad kezeltnek jelolni -- igy ugyanaz a koppintas a
   * bejelentkezes utan meg hat.
   */
  usePushNavigation(status);

  if (status === "restoring") {
    return (
      <RestoringScreen
        networkError={restoreNetworkError}
        onRetry={retryRestore}
      />
    );
  }

  // Like `restoring`, this replaces the route Stack rather than sitting on
  // top of it: with the gate shut, no authenticated screen should mount at
  // all, not even for the frame it would take to redirect away.
  if (status === "locked") {
    return (
      <LockedScreen
        displayName={user?.displayName}
        reason={lockReason}
        onUnlock={unlock}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: "#071827" },
        headerStyle: { backgroundColor: "#0b263d" },
        headerTintColor: "#f4fbff",
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Acropora OS" }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="orders/index" options={{ title: "Rendelések" }} />
      <Stack.Screen
        name="orders/[id]"
        options={{ title: "Rendelés részletei" }}
      />
      <Stack.Screen name="settings" options={{ title: "Beállítások" }} />
      <Stack.Screen name="queue" options={{ title: "Feltöltésre várók" }} />
      <Stack.Screen
        name="queue-fix/[id]"
        options={{ title: "Elakadt felvitel" }}
      />
      <Stack.Screen
        name="queue-resolve/[id]"
        options={{ title: "Elakadt módosítás" }}
      />
      {/*
        A CIM ITT ALL, NEM A KEPERNYON: a fejlec a navigatore. Regisztralas
        nelkul az expo-router a FAJL NEVET tenne a fejlecbe ("service-jobs"),
        ami a szerelonek semmit nem mond.
      */}
      <Stack.Screen
        name="service-jobs/index"
        options={{ title: "Hibajegyek" }}
      />
      <Stack.Screen name="service-jobs/[id]" options={{ title: "Hibajegy" }} />
      <Stack.Screen
        name="service-jobs/new"
        options={{ title: "Új hibajegy" }}
      />
      <Stack.Screen name="worksheets/index" options={{ title: "Munkalapok" }} />
      <Stack.Screen name="worksheets/new" options={{ title: "Új munkalap" }} />
      <Stack.Screen name="worksheets/[id]" options={{ title: "Munkalap" }} />
      {/*
        AZ ALAIRAS FEDO MODALISKENT NYILIK, ES A KET OPCIO NEM DISZ.

        Balazs kerese (2026-09-18 07:01 UTC): "Szeretnek egy Alairas gombot az
        aljara. ha azt megnyomjuk akkor egy felugro ablakban..."

        A `fullScreenModal` adja a felugro alakot UGY, hogy a mogotte levo
        munkalap-adatlap NEM latszik es nem erheto el. A `gestureEnabled: false`
        pedig azt zarja el, hogy egy lehuzo mozdulat visszavigyen ra.

        MIERT KELL MIND A KETTO: ezt a kepernyot a szerelo ODAADJA az ugyfelnek.
        A mogotte allo adatlapon tetel-felvitel es torles van -- egy veletlen
        lehuzas az ugyfel kezebe adna a szerelo munkaeszkozet. A kifele vezeto
        ut CSAK a fejlec vissza-gombja marad, amit a szerelo nyom meg, miutan
        visszavette a telefont.

        Ezt a ket opciot orzo meri (`apps/api/src/mobile/worksheet-sign-modal.spec.ts`):
        a vedelem KIZAROLAG rajtuk all, es a hianyuk semmilyen mas jelet nem adna.
      */}
      <Stack.Screen
        name="worksheets/sign/[id]"
        options={{
          title: "Munkalap aláírása",
          presentation: "fullScreenModal",
          gestureEnabled: false,
        }}
      />
      {/*
        A KIKULDES ALAIRASRA UGYANUGY FELUGRO, DE `gestureEnabled` NELKUL.

        A felugro alak Balazs kerese (2026-09-18 07:01 UTC): "Utana felugro
        ablak es kivalaszthatom minek kuldom el a partner alairoibol".

        ES A `gestureEnabled: false` ITT SZANDEKOSAN HIANYZIK. Az alairas-
        kepernyon azert all, mert azt a szerelo ODAADJA az ugyfelnek, es egy
        lehuzas az ugyfel kezebe adna a mogotte levo tetel-szerkesztest. A
        kikuldesnel a telefon VEGIG a szerelonel marad -- itt a lehuzas
        elzarasa nem vedene semmit, csak elvenne a megszokott kifele utat.
      */}
      <Stack.Screen
        name="worksheets/send-for-signature/[id]"
        options={{
          title: "Kiküldés aláírásra",
          presentation: "fullScreenModal",
        }}
      />
      <Stack.Screen
        name="material-requests/index"
        options={{ title: "Anyagigények" }}
      />
      {/*
        EZ A KEPERNYO SOSEM LATSZIK: azonnal tovabbiranyit a munkalapra (lasd
        a fajl sajat fejleceit). A `headerShown: false` nem diszites, hanem
        azt zarja ki, hogy a fejlec egy pillanatra felvillanjon a
        tovabbiranyitas elott.
      */}
      <Stack.Screen
        name="material-requests/[id]"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="assets/index" options={{ title: "Eszközök" }} />
      <Stack.Screen name="assets/new" options={{ title: "Új eszköz" }} />
      <Stack.Screen
        name="assets/scanner"
        options={{ title: "QR-kód beolvasása" }}
      />
      <Stack.Screen name="assets/[id]" options={{ title: "Eszköz adatlap" }} />
      <Stack.Screen
        name="assets/edit/[id]"
        options={{ title: "Eszköz szerkesztése" }}
      />
      <Stack.Screen
        name="assets/scan/[token]"
        options={{ title: "QR-azonosítás" }}
      />
      <Stack.Screen name="partners/index" options={{ title: "Partnerek" }} />
      <Stack.Screen
        name="partners/[id]"
        options={{ title: "Partner adatlap" }}
      />
      <Stack.Screen name="aquariums/index" options={{ title: "Akváriumok" }} />
      <Stack.Screen name="aquariums/new" options={{ title: "Új akvárium" }} />
      {/*
        HIANYZOTT, A `[id]` ES A `[id]/measurement` KEPERNYOVEL EGYUTT
        (2026-09-25, a vizmeres-push utvonal vizsgalata kozben talalva). A
        hianyuk NEM zarta el a navigaciot -- az expo-router fajl-alapu
        utvonalai a Stack.Screen bejegyzes NELKUL is elerhetok, csak a
        fejlec a fajlnevre esett vissza -- de a `PUSH_TARGET_ROUTES.aquarium`
        pontosan ide mutat, tehat a cimsor itt tartozik a tobbi celponthoz.
      */}
      <Stack.Screen
        name="aquariums/[id]"
        options={{ title: "Akvárium adatlap" }}
      />
      <Stack.Screen
        name="aquariums/[id]/measurement"
        options={{ title: "Vízmérés rögzítése" }}
      />
    </Stack>
  );
}
