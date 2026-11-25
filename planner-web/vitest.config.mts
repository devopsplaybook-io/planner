import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    // common-web is published as raw sources that import their own .vue files;
    // it must go through Vite's transform pipeline in tests too.
    server: {
      deps: {
        inline: ["@devopsplaybook.io/common-web"],
      },
    },
  },
});
