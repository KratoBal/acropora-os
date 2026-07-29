import "react-native-gesture-handler";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { queryClient } from "@/lib/query-client";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: "#071827" },
          headerStyle: { backgroundColor: "#0b263d" },
          headerTintColor: "#f4fbff",
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Acropora OS" }} />
      </Stack>
    </QueryClientProvider>
  );
}
