/**
 * Collapses content that overflows a fixed em cap behind a "Show more"
 * disclosure. Mirrors the comment-truncation approach in TaskDetailDialog:
 * the inner, unclipped element is measured with a ResizeObserver so
 * re-measurement happens whenever its box actually changes (the dialog
 * opening via showModal, a <details> expanding, an image loading, text
 * re-wrapping). A one-shot measure races with dialog rendering — the box
 * can still be display:none and report scrollHeight 0 — so the observer is
 * the source of truth for whether the content overflows.
 *
 * The collapsed cap (collapsedEm) must match the max-height applied by the
 * `.markdown-collapse.is-truncated` CSS in main.css (10em by default): the
 * measured element and the clipped element share the same font-size, so
 * `fontSize * collapsedEm` equals the visible cap.
 *
 * Usage:
 *   const { expanded, overflowing, setContentEl, toggle, reset } =
 *     useOverflowCollapse();
 *
 *   <div class="markdown-collapse"
 *        :class="{ 'is-truncated': !expanded, 'is-overflowing': overflowing }">
 *     <div :ref="setContentEl" class="markdown-collapse-content">…</div>
 *   </div>
 *   <button v-if="overflowing" :aria-expanded="expanded" @click="toggle">
 *     {{ expanded ? 'Show less' : 'Show more' }}
 *   </button>
 *
 * Call reset() after the underlying record changes (switching task/note/
 * project, or leaving Edit mode) to collapse again; the observer then
 * re-measures overflow once the new content has rendered.
 */
export function useOverflowCollapse(collapsedEm = 10) {
  const expanded = ref(false);
  const overflowing = ref(false);
  let contentEl = null;

  function measure() {
    if (!contentEl) {
      overflowing.value = false;
      return;
    }
    const fontSize = parseFloat(getComputedStyle(contentEl).fontSize) || 16;
    overflowing.value = contentEl.scrollHeight > fontSize * collapsedEm + 1;
  }

  const observer = new ResizeObserver(measure);

  // Used as a template function ref: called with the element on mount and
  // with null on unmount (e.g. when Edit mode swaps the content out).
  function setContentEl(el) {
    if (el === contentEl) return;
    if (contentEl) observer.unobserve(contentEl);
    contentEl = el || null;
    if (contentEl) {
      observer.observe(contentEl);
      measure();
    } else {
      overflowing.value = false;
    }
  }

  function toggle() {
    expanded.value = !expanded.value;
  }

  function reset() {
    expanded.value = false;
    measure();
  }

  onUnmounted(() => observer.disconnect());

  return { expanded, overflowing, setContentEl, toggle, reset };
}
