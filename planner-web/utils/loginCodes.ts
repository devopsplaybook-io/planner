import {
  createLoginCodeService,
  type LoginCodeHttpClient,
  type LoginCodeService,
} from "@devopsplaybook.io/common-web/services/LoginCodeService";
import api from "./api";
import { useAuthStore } from "../stores/auth";

/**
 * The shared login-code client wired to Planner: requests ride the app's
 * axios instance (so they resolve under the API base URL and reuse its
 * error handling), approvals carry the interactive JWT session, and a
 * redeemed code installs the freshly minted session in the auth store.
 */
export function createPlannerLoginCodeService(): LoginCodeService {
  const authStore = useAuthStore();
  return createLoginCodeService({
    baseUrl: "users/login-codes",
    http: api as unknown as LoginCodeHttpClient,
    getAuthHeader: () =>
      authStore.token
        ? { Authorization: `Bearer ${authStore.token}` }
        : undefined,
    onSession: (token, user) => authStore.applySession(token, user),
  });
}
