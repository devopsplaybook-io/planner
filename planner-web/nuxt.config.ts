// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  ssr: false,
  experimental: {
    viteEnvironmentApi: true,
  },
  app: {
    head: {
      charset: "utf-8",
      viewport: "width=device-width, initial-scale=1",
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
  // The package exports extensionless source paths; map the package to its
  // installed directory so both Vite and the generated tsconfig resolve the
  // raw .vue/.ts subpath imports.
  alias: {
    "@devopsplaybook.io/common-web": fileURLToPath(
      new URL(
        "./node_modules/@devopsplaybook.io/common-web",
        import.meta.url,
      ),
    ),
  },
  // common-web is consumed as raw .vue/.ts sources (Planner does not use the
  // Nuxt layer), so Vite must transpile it and leave it out of pre-bundling.
  build: {
    transpile: ["@devopsplaybook.io/common-web"],
  },
  vite: {
    optimizeDeps: {
      exclude: ["@devopsplaybook.io/common-web"],
    },
  },
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
      navigateFallbackDenylist: [/^\/api\//, /^\/share-target/],
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
      // Best-effort PWA audio share: supported browsers POST the audio file
      // to /share-target, which redirects to the inbox. The file is not
      // retained by the server; the user can import it from the inbox.
      share_target: {
        action: "/share-target",
        method: "POST",
        enctype: "multipart/form-data",
        params: {
          files: [
            {
              name: "file",
              accept: ["audio/*", "video/mp4"],
            },
          ],
        },
      },
    },
  },
});
