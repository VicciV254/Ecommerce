import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { clientDeploymentDefine } from "./src/deployment";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // The hosting platform decides the environment at build time; a hosted build from the wrong branch stops here.
  define: clientDeploymentDefine(process.env),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
