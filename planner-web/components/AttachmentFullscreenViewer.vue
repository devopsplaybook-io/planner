<template>
  <div v-if="attachment" class="fullscreen-overlay" @click="emit('close')">
    <button
      class="fullscreen-close"
      aria-label="Close"
      @click.stop="emit('close')"
    >
      ×
    </button>
    <img
      v-if="viewerKind === 'image'"
      :src="attachment.url"
      :alt="attachment.fileName"
      class="fullscreen-image"
      @click.stop
    />
    <!-- Plain iframe on purpose: a sandboxed frame (attribute or CSP) blocks
         the browser's built-in PDF viewer -->
    <iframe
      v-else-if="viewerKind === 'pdf'"
      :src="attachment.url"
      :title="attachment.fileName"
      class="fullscreen-pdf"
      @click.stop
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { getAttachmentViewerKind } from "../utils/attachments";

const props = defineProps({
  attachment: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["close"]);

const viewerKind = computed(() =>
  props.attachment ? getAttachmentViewerKind(props.attachment.fileName) : null,
);
</script>

<style scoped>
.fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.fullscreen-image {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  cursor: default;
  border-radius: var(--radius-sm);
}

.fullscreen-pdf {
  width: 90vw;
  height: 90vh;
  border: none;
  background: #fff;
  border-radius: var(--radius-sm);
  cursor: default;
}

.fullscreen-close {
  position: fixed;
  top: var(--space-md);
  right: var(--space-md);
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 2.5em;
  height: 2.5em;
  font-size: var(--text-2xl);
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fullscreen-close:hover {
  background: rgba(0, 0, 0, 0.8);
}
</style>
