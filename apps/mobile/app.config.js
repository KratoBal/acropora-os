const variants = {
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

function resolveVariant() {
  const value = process.env.APP_VARIANT ?? "development";

  if (
    value === "development" ||
    value === "preview" ||
    value === "production"
  ) {
    return value;
  }

  throw new Error(
    `Invalid APP_VARIANT "${value}". Expected development, preview or production.`,
  );
}

module.exports = ({ config }) => {
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
updates: {
  url: "https://u.expo.dev/95c3f5b6-fd32-4ca8-8465-62a4c1e6243c",
},
runtimeVersion: {
  policy: "appVersion",
},					
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
  eas: {
    projectId: "95c3f5b6-fd32-4ca8-8465-62a4c1e6243c",
  },
},
  };
};
