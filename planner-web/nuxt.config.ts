// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  experimental: {
    viteEnvironmentApi: true,
  },
  app: {
    head: {
      charset: "utf-16",
      viewport:
        "width=device-width, initial-scale=1, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      title: "Planner",
      meta: [
        { name: "description", content: "planner" },
        { name: "theme-color", content: "#212121" },
      ],
      link: [{ rel: "icon", type: "image/svg+xml", href: "/images/logo.svg" }],
    },
  },
  css: [
    "@picocss/pico",
    "bootstrap-icons/font/bootstrap-icons.css",
    "~/assets/css/main.css",
  ],
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt"],
  imports: {
    dirs: ["./stores"],
  },
  pinia: {
    autoImports: ["defineStore", "acceptHMRUpdate"],
  },
  pwa: {
    registerType: "autoUpdate",
    includeAssets: ["images/logo.svg"],
    workbox: {
      globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
      runtimeCaching: [
        {
          urlPattern: "/api/**",
          handler: "NetworkFirst",
          options: {
            cacheName: "api-cache",
            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: "/_nuxt/**",
          handler: "CacheFirst",
          options: {
            cacheName: "nuxt-assets",
            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
      ],
    },
    manifest: {
      name: "Planner",
      short_name: "Planner",
      lang: "en-US",
      start_url: "/",
      display: "standalone",
      background_color: "#12191f",
      theme_color: "#12191f",
      icons: [
        {
          src: "images/logo.svg",
          sizes: "512x512",
          type: "image/svg+xml",
        },
      ],
    },
  },
});
