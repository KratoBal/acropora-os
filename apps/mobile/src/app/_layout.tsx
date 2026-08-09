import "react-native-gesture-handler";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { RestoringScreen } from "@/components/RestoringScreen";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { queryClient } from "@/lib/query-client";

export default function RootLayout() {
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
  const { status, restoreNetworkError, retryRestore } = useAuth();

  if (status === "restoring") {
    return (
      <RestoringScreen
        networkError={restoreNetworkError}
        onRetry={retryRestore}
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
    </Stack>
  );
}
