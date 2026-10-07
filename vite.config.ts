import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Tests read the English catalog, so text assertions are stable.
  test: { setupFiles: ["./src/test-setup.ts"] },
});
