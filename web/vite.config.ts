import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  // The text studio's HarfBuzz (WebAssembly) loads itself with a top-level await and finds its
  // .wasm next to it: kept out of pre-bundling, built for browsers that run top-level await.
  // clipper2-ts is listed up front, so the first studio visit in dev doesn't reload the page.
  optimizeDeps: {
    exclude: ["harfbuzzjs"],
    include: ["@forgea/text3d > clipper2-ts"],
  },
  build: { target: "es2022" },
});
