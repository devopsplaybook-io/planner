import { acceptHMRUpdate, defineStore } from "pinia";

export const useCommandPaletteStore = defineStore("commandPalette", {
  state: () => ({
    open: false,
  }),

  actions: {
    openPalette() {
      this.open = true;
    },
    closePalette() {
      this.open = false;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useCommandPaletteStore, import.meta.hot),
  );
}
