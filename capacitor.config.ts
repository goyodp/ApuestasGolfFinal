import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.apuestas.golf",
  appName: "Apuestas Golf",
  webDir: "dist",
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
    },
  },
};

export default config;
