<template>
  <div class="toast-stack" role="status" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :class="`toast--${toast.kind}`"
      :role="toast.kind === 'error' ? 'alert' : 'status'"
    >
      <button
        type="button"
        class="toast-body"
        :disabled="!toast.url"
        @click="open(toast)"
      >
        <i class="bi" :class="icon(toast.kind)" />
        <span class="toast-text">
          <strong>{{ toast.title }}</strong>
          <span v-if="toast.message" class="toast-message">{{
            toast.message
          }}</span>
        </span>
      </button>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss notification"
        @click="dismissToast(toast.id)"
      >
        <i class="bi bi-x" />
      </button>
    </div>
  </div>
</template>

<script setup>
const router = useRouter();
const { toasts, dismissToast } = useToasts();

function icon(kind) {
  if (kind === "success") return "bi-check-circle";
  if (kind === "error") return "bi-exclamation-triangle";
  return "bi-bell";
}

function open(toast) {
  if (!toast.url) {
    return;
  }
  dismissToast(toast.id);
  router.push(toast.url);
}
</script>

<style scoped>
.toast-stack {
  position: fixed;
  right: var(--space-sm);
  bottom: calc(var(--space-sm) + env(safe-area-inset-bottom, 0px));
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  max-width: min(360px, calc(100vw - 2 * var(--space-sm)));
}

.toast {
  display: flex;
  align-items: stretch;
  gap: var(--space-2xs);
  background: var(--color-surface-raised, var(--color-surface));
  color: var(--color-text);
  border: 1px solid var(--color-border-strong);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.25));
  overflow: hidden;
}

.toast--success {
  border-left-color: var(--color-success, #2e9e5b);
}

.toast--error {
  border-left-color: var(--color-danger, #d64545);
}

.toast-body {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2xs);
  flex: 1;
  padding: var(--space-xs) var(--space-sm);
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.toast-body:disabled {
  cursor: default;
}

.toast-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toast-message {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.toast-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  padding: 0 var(--space-2xs);
  cursor: pointer;
}
</style>