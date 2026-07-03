export default {
  expo: {
    name: "eVoting System Pro",
    slug: "evotingsystempro",
    version: "1.3.0",
    orientation: "portrait",
    icon: "./assets/images/round_icon.png",
    scheme: "evotingsystempro",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    notification: {
      vapidPublicKey: "BL1dK5OssbM41dRs6pUPlWlTx1WBi7yvHua6VCymQMbx5YqL15mezBdvJPasBcPgDyDhWF0Uu3MJP8ACxW_Gfmw",
      serviceWorkerPath: "./sw.js",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.developershandle.evotingsystempro",
      usesAppleSignIn: true,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#faf7f2ff",
      },
      package: "com.developershandle.evotingsystempro",
      googleServicesFile: "./google-services.json",
    },
    web: {
      bundler: "metro",
      output: "server",
      favicon: "./assets/images/favicon.png",
      themeColor: "#000000",
    },
    plugins: [
      ["expo-router", { origin: "https://evotingsystempro.expo.app" }],
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 100,
          resizeMode: "contain",
          backgroundColor: "#fff",
        },
      ],
      "expo-secure-store",
      "expo-apple-authentication",
      "expo-asset",
    ],
    experiments: {
      typedRoutes: true,
    },
    owner: "developershandle",
    extra: {
      EXPO_PUBLIC_BASE_URL: "https://evotingsystempro.expo.app",
      router: {
        origin: "https://evotingsystempro.expo.app",
      },
      eas: {
        projectId: "de92720f-ae00-45d1-a0eb-56d2b3dff0e8",
      },
      expoConfig: {},
    },
  },
};