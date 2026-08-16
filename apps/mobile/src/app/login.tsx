import { useState } from "react";
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

export default function LoginScreen() {
  const { assetToken } = useLocalSearchParams<{ assetToken?: string }>();
  const { status, signInError, signIn } = useAuth();
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
                placeholderTextColor="#5b7c92"
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
                  placeholderTextColor="#5b7c92"
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
                <ActivityIndicator color="#ffffff" />
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#071827",
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
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  title: {
    color: "#f4fbff",
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: "#b7cedd",
    fontSize: 15,
  },
  form: {
    gap: 18,
  },
  field: {
    gap: 8,
  },
  label: {
    color: "#7ea3b9",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#0b263d",
    borderColor: "#164668",
    borderRadius: 12,
    borderWidth: 1,
    color: "#f4fbff",
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
    color: "#52d6c7",
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    color: "#ff9f92",
    fontSize: 14,
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: "#166a7a",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 48,
    paddingVertical: 12,
  },
  submitButtonPressed: {
    opacity: 0.75,
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
