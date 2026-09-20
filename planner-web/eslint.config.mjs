// @ts-check
import withNuxt from "@nuxt/eslint-config";

export default withNuxt().overrideRules({
  "vue/multi-word-component-names": "off",
  // Vue 2-only rule: multiple template roots are valid since Vue 3
  "vue/no-multiple-template-root": "off",
});
