import { defineConfig } from "vite";
export default defineConfig({
  root: "src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split heavy third-party libraries into a separate vendor chunk.
        // This chunk is content-hashed and cached long-term by browsers;
        // only the smaller app chunk needs to be re-fetched on each deploy.
        manualChunks: {
          vendor: ["three", "cannon-es", "gsap", "textalive-app-api", "troika-three-text"],
        },
      },
    },
  },
  server: { open: true },
});