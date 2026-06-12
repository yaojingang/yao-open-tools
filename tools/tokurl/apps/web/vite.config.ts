import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

export default defineConfig({
  plugins: [react() as unknown as PluginOption],
  server: {
    port: 3000
  },
  preview: {
    port: 3000
  }
});
