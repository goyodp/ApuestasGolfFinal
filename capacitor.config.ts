/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.apuestas.golf",
  appName: "Apuestas Golf",
  webDir: "dist",
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
      // CRÍTICO: carga los SDK/providers nativos que vas a usar.
      providers: ["google.com", "apple.com"],
    },
  },
};

export default config;
