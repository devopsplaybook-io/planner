/**
 * Remembers the collapsed/expanded state of a dialog's <details> sections
 * in localStorage (JSON map of section name → open boolean), one key per
 * dialog type (e.g. "planner.sectionState.taskDialog"). Semantics:
 * - a stored preference always wins;
 * - a section the user never touched defaults to open when it has content;
 * - every access is guarded: when storage is unavailable the content-based
 *   defaults apply.
 *
 * Programmatic changes to the :open binding also fire native `toggle`
 * events (e.g. on task switch when a section gains or loses content).
 * onToggle only persists when the new DOM state differs from the computed
 * state — i.e. on real user clicks — so content-driven flips are never
 * stored as preferences.
 *
 * Usage:
 *   const { isSectionOpen, onSectionToggle, forceSectionOpen, reset } =
 *     useSectionState("planner.sectionState.taskDialog");
 *
 *   <details :open="isSectionOpen('comments', hasComments)"
 *            @toggle="onSectionToggle('comments', $event, hasComments)">
 *
 * forceSectionOpen (deep links) opens a section without persisting a
 * preference; reset clears the overrides (e.g. on record switch).
 */
export function useSectionState(storageKey: string) {
  const state = ref(load());
  const forced = ref(new Set<string>());

  function load(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  function save(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.value));
    } catch {
      // Storage unavailable: section state simply doesn't persist
    }
  }

  function isSectionOpen(section: string, hasContent: boolean): boolean {
    if (forced.value.has(section)) return true;
    const stored = state.value[section];
    return stored === undefined || stored === null
      ? hasContent
      : !!stored;
  }

  function forceSectionOpen(section: string): void {
    const next = new Set(forced.value);
    next.add(section);
    forced.value = next;
  }

  function onSectionToggle(
    section: string,
    event: Event,
    hasContent: boolean,
  ): void {
    const open = (event.target as HTMLDetailsElement | null)?.open ?? false;
    if (open === isSectionOpen(section, hasContent)) return;
    if (forced.value.has(section)) {
      // The user closed a force-expanded section: drop the override so the
      // :open binding follows the (now persisted) preference again
      const next = new Set(forced.value);
      next.delete(section);
      forced.value = next;
    }
    state.value = { ...state.value, [section]: open };
    save();
  }

  function reset(): void {
    forced.value = new Set();
  }

  return { isSectionOpen, onSectionToggle, forceSectionOpen, reset };
}
