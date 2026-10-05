/**
 * Pure permission-aware helpers for the Settings page tabs: Profile first
 * for every user, the admin tabs (Users, Projects, Statuses) only for
 * admins. Server-side authorization is unchanged (AuthMustBeAdmin).
 */

export interface SettingsTab {
  id: string;
  label: string;
}

export function getSettingsTabs(isAdmin: boolean): SettingsTab[] {
  const tabs: SettingsTab[] = [{ id: "profile", label: "Profile" }];
  if (isAdmin) {
    tabs.push(
      { id: "users", label: "Users" },
      { id: "projects", label: "Projects" },
      { id: "statuses", label: "Statuses" },
    );
  }
  return tabs;
}

/**
 * Resolves a ?tab= query value to a tab the role may see, falling back to
 * "profile" for unknown or unauthorized values.
 */
export function normalizeSettingsTab(tab: unknown, isAdmin: boolean): string {
  const allowed = getSettingsTabs(isAdmin).map((t) => t.id);
  return allowed.includes(tab as string) ? (tab as string) : "profile";
}
