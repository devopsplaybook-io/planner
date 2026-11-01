import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";
import { isTokenExpired } from "../utils/jwt";

export interface UserSession {
  isAuthenticated: boolean;
  userId?: string;
  userName?: string;
  role?: "admin" | "user";
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem("token") || "",
    user: JSON.parse(localStorage.getItem("user") || "null") as Record<
      string,
      unknown
    > | null,
    initialized: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token && !isTokenExpired(state.token),
    isAdmin: (state) => state.user?.role === "admin",
    currentUser: (state) => state.user,
  },

  actions: {
    async init() {
      const token = localStorage.getItem("token");
      if (!token || isTokenExpired(token)) {
        this.logout();
        this.initialized = true;
        return;
      }
      this.token = token;
      // Verify with the server once per app start. A network or server
      // error keeps the locally valid session so the installed PWA still
      // opens offline; only an explicit rejection ends it.
      try {
        const res = await api.post("/users/session", {});
        this.user = res.data.user;
        localStorage.setItem("user", JSON.stringify(this.user));
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response
          ?.status;
        if (status === 400 || status === 401 || status === 403) {
          this.logout();
        }
      }
      this.initialized = true;
    },

    async login(name: string, password: string) {
      const res = await api.post("/users/session", { name, password });
      this.token = res.data.token;
      this.user = res.data.user;
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      return res.data;
    },

    async register(name: string, password: string) {
      const res = await api.post("/users", { name, password });
      return res.data;
    },

    async changePassword(passwordOld: string, password: string) {
      await api.put("/users/password", { passwordOld, password });
    },

    logout() {
      this.token = "";
      this.user = null;
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    },
  },
});

// Enable HMR for this store
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
