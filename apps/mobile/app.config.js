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
        "expo-local-authentication",
        {
          faceIDPermission:
            "Az Acropora OS a Face ID-vel ellenőrzi, hogy te vagy a készülék tulajdonosa, mielőtt a munkalapok és ügyféladatok láthatóvá válnak.",
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "Az Acropora OS a kamera segítségével olvassa be az eszközök QR-kódját.",
          recordAudioAndroid: false,
          barcodeScannerEnabled: true,
        },
      ],
      /**
       * A GALÉRIA-HOZZÁFÉRÉS SZÖVEGE NÉLKÜL AZ iOS AZONNAL LEÁLLÍTJA AZ APPOT,
       * amint a választó megnyílna - nem elutasítást ad, hanem összeomlást, és
       * a hiba csak eszközön látszik, a fejlesztői futtatáson nem feltétlenül.
       *
       * A kamera-jogot NEM kérjük ide: a fénykép ma a galériából jön. Ha egyszer
       * közvetlen fényképezés is kell, az külön jog és külön szöveg.
       */
      [
        "expo-image-picker",
        {
          photosPermission:
            "Az Acropora OS a fényképeidhez fér hozzá, hogy a helyszínen készült képeket az eszköz adatlapjához csatolhasd.",
          /**
           * A KAMERA-SZÖVEG AZ ELSŐDLEGES ÚTHOZ TARTOZIK, nem egy ritka
           * mellékesethez: a szerelő a helyszínen MOST készít képet, nem régit
           * keres (Balázs, 2026-09-02).
           *
           * A szöveg hiánya nem elutasítást ad, hanem LEÁLLÍTJA az appot abban
           * a pillanatban, amikor a kamera megnyílna - és ez fejlesztői
           * futtatáson nem feltétlenül látszik.
           */
          cameraPermission:
            "Az Acropora OS a kamerát használja, hogy a helyszínen készült fényképet azonnal az eszköz adatlapjához csatolhasd.",
        },
      ],
      [
        "expo-splash-screen",
        {
          backgroundColor: "#071827",
          image: "./assets/images/splash-icon.png",
          imageWidth: 96,
        },
      ],
      /**
       * A rendszer saját dátumválasztója. NATÍV modul, tehát csak új buildben
       * jelenik meg: egy éteren át küldött frissítés nem hozza magával.
       */
      "@react-native-community/datetimepicker",
    ],
    experiments: {
      /**
       * TYPED ROUTES ARE ON, AND THEY GATE NOTHING IN CI. Measured 2026-08-28.
       *
       * The route types are generated into `.expo/types`, and that directory
       * is git-ignored (.gitignore:7). A clean CI checkout therefore has no
       * route types to check against: `pnpm mobile:typecheck` walks past an
       * `href` pointing at a screen that does not exist, without a word.
       *
       * Nor is there a command that would produce them. Expo's CLI has no
       * dedicated generator - the types fall out of `expo start` or
       * `expo export` - and `expo export --platform web` dies after 5.7
       * seconds on an unrelated dependency (`wa-sqlite.wasm`, from
       * expo-sqlite's web worker), producing no types at all.
       *
       * THE FLAG STAYS ON, because it is what produces the types at all - an
       * editor pointed at a running dev server gets them. But what it gives
       * depends on someone having RUN that server: in this checkout the
       * `.expo/types` directory does not exist at all (measured, together with
       * `git ls-files apps/mobile/.expo`, which is empty). What the flag must
       * not do is look like a gate to whoever reads this file next.
       *
       * The gate that does run lives in
       * `apps/api/src/mobile/mobile-screen-routes.spec.ts`, on the API side,
       * where CI compiles and runs it anyway. It is NARROWER on purpose: it
       * asserts that every navigation target matches a route file on disk, not
       * that the parameters or the query shape are right.
       *
       * WHEN THIS BECOMES A REAL GATE: the day `expo export` runs to
       * completion. That is a fact anyone can check with one command, not a
       * date and not a person to wait for. Committing the generated types is
       * the other option and it is deliberately NOT taken: a stale generated
       * type file does not stay quiet, it says something WRONG - rejecting a
       * route that exists, or accepting one that is gone - and nothing signals
       * that it expired.
       */
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
