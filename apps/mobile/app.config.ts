import type { ConfigContext, ExpoConfig } from "expo/config";

type AppVariant = "development" | "preview" | "production";

const variants: Record<
  AppVariant,
  {
    displayName: string;
    bundleIdentifier: string;
    scheme: string;
  }
> = {
  development: {
    displayName: "Acropora OS Dev",
    bundleIdentifier: "hu.acropora.os.dev",
    scheme: "acropora-os-dev",
  },
  preview: {
    displayName: "Acropora OS Preview",
    bundleIdentifier: "hu.acropora.os.preview",
    scheme: "acropora-os-preview",
  },
  production: {
    displayName: "Acropora OS",
    bundleIdentifier: "hu.acropora.os",
    scheme: "acropora-os",
  },
};

function resolveVariant(): AppVariant {
  const value = process.env.APP_VARIANT ?? "development";
  if (value === "development" || value === "preview" || value === "production") {
    return value;
  }

  throw new Error(
    `Invalid APP_VARIANT "${value}". Expected development, preview or production.`,
  );
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant();
  const selected = variants[variant];

  return {
    ...config,
    name: selected.displayName,
    slug: "acropora-os",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: selected.scheme,
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: selected.bundleIdentifier,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: selected.bundleIdentifier,
      predictiveBackGestureEnabled: false,
      adaptiveIcon: {
        backgroundColor: "#071827",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-notifications",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#071827",
          image: "./assets/images/splash-icon.png",
          imageWidth: 96,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      appVariant: variant,
    },
  };
};
