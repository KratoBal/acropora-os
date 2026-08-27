import "react-native-gesture-handler";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { LockedScreen } from "@/components/LockedScreen";
import { RestoringScreen } from "@/components/RestoringScreen";
import { environment } from "@/config/env";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { queryClient } from "@/lib/query-client";

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
      <Stack.Screen name="worksheets/index" options={{ title: "Munkalapok" }} />
      <Stack.Screen name="worksheets/[id]" options={{ title: "Munkalap" }} />
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
    </Stack>
  );
}
