import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useLocalSearchParams } from "expo-router";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

export default function LoginScreen() {
  const { assetToken } = useLocalSearchParams<{ assetToken?: string }>();
  const { status, signInError, signIn } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Already signed in (e.g. session restored while this screen was still
  // mounted) — never show the login form on top of an authenticated
  // session.
  if (status === "authenticated") {
    return assetToken ? (
      <Redirect
        href={{
          pathname: "/assets/scan/[token]",
          params: { token: assetToken },
        }}
      />
    ) : (
      <Redirect href="/" />
    );
  }

  const submitting = status === "signingIn";
  const errorMessage = localError ?? signInError;

  async function handleSubmit() {
    setLocalError(null);
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setLocalError("Add meg az e-mail címet és a jelszót.");
      return;
    }

    await signIn(trimmedEmail, password);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>ACROPORA OS</Text>
            <Text style={styles.title}>Terepi rendszer</Text>
            <Text style={styles.subtitle}>
              Jelentkezz be a munkamenet indításához.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>E-mail cím</Text>
              <TextInput
                accessibilityLabel="E-mail cím"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="username"
                keyboardType="email-address"
                importantForAutofill="yes"
                editable={!submitting}
                value={email}
                onChangeText={setEmail}
                placeholder="pl. nev@acropora.hu"
                placeholderTextColor={tokens.textMuted}
                style={[styles.input, submitting && styles.inputDisabled]}
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Jelszó</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  accessibilityLabel="Jelszó"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  importantForAutofill="yes"
                  editable={!submitting}
                  secureTextEntry={!passwordVisible}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Jelszó"
                  placeholderTextColor={tokens.textMuted}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    submitting && styles.inputDisabled,
                  ]}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    passwordVisible
                      ? "Jelszó elrejtése"
                      : "Jelszó megjelenítése"
                  }
                  disabled={submitting}
                  onPress={() => setPasswordVisible((visible) => !visible)}
                  style={styles.toggleButton}
                >
                  <Text style={styles.toggleButtonText}>
                    {passwordVisible ? "Elrejt" : "Mutat"}
                  </Text>
                </Pressable>
              </View>
            </View>

            {errorMessage ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {errorMessage}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bejelentkezés"
              accessibilityState={{ disabled: submitting }}
              disabled={submitting}
              onPress={() => void handleSubmit()}
              style={({ pressed }) => [
                styles.submitButton,
                (pressed || submitting) && styles.submitButtonPressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={tokens.textOnAccent} />
              ) : (
                <Text style={styles.submitButtonText}>Bejelentkezés</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- Figma 12.
 * kör, a maradék telefonos képernyők átültetése (az Eszközök #1087/#1089
 * és a Munkalapok #1124-#1126 mintáját követve): ez a képernyő eddig saját,
 * fix sötét hexekkel élt (`#071827`, `#0b263d` stb.), amiket a
 * `_layout.tsx` fejléce is idézett -- lásd annak saját, ugyanebben a
 * körben frissített fejlécszíneit.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: t.background,
    },
    flex: {
      flex: 1,
    },
    container: {
      flexGrow: 1,
      justifyContent: "center",
      padding: 24,
      gap: 32,
    },
    hero: {
      gap: 8,
    },
    eyebrow: {
      color: t.accent,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1.6,
    },
    title: {
      color: t.textPrimary,
      fontSize: 28,
      fontWeight: "800",
    },
    subtitle: {
      color: t.textSecondary,
      fontSize: 15,
    },
    form: {
      gap: 18,
    },
    field: {
      gap: 8,
    },
    label: {
      color: t.textSecondary,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    input: {
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 12,
      borderWidth: 1,
      color: t.textPrimary,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    inputDisabled: {
      opacity: 0.6,
    },
    passwordRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
    },
    passwordInput: {
      flex: 1,
    },
    toggleButton: {
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    toggleButtonText: {
      color: t.accent,
      fontSize: 13,
      fontWeight: "700",
    },
    errorText: {
      color: t.danger,
      fontSize: 14,
    },
    submitButton: {
      alignItems: "center",
      backgroundColor: t.accent,
      borderRadius: 12,
      justifyContent: "center",
      minHeight: 48,
      paddingVertical: 12,
    },
    submitButtonPressed: {
      opacity: 0.75,
    },
    submitButtonText: {
      color: t.textOnAccent,
      fontSize: 16,
      fontWeight: "700",
    },
  });
}
