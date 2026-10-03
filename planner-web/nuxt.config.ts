// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  experimental: {
    viteEnvironmentApi: true,
  },
  app: {
    head: {
      charset: "utf-8",
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
    "bootstrap-icons/font/bootstrap-icons.css",
    "~/assets/css/tokens.css",
    "~/assets/css/base.css",
    "~/assets/css/main.css",
  ],
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt"],
  imports: {
    dirs: ["./stores"],
  },
  pwa: {
    registerType: "autoUpdate",
    workbox: {
      // Precache the built app shell (HTML/JS/CSS) so the SPA loads offline,
      // plus the app icons so notification icon/badge resolve offline too
      globPatterns: ["**/*.{js,css,html}", "images/*.{png,svg}"],
      // Offline navigations fall back to the cached app shell; API calls are
      // never navigation requests and stay excluded
      navigateFallback: "/",
      navigateFallbackDenylist: [/^\/api\//],
      skipWaiting: true,
      clientsClaim: true,
      importScripts: ["sw-push.js"],
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
        {
          src: "images/logo-512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    },
  },
});
