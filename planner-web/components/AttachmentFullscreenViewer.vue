<template>
  <div v-if="attachment" class="fullscreen-overlay" @click="emit('close')">
    <div class="fullscreen-actions">
      <button
        class="fullscreen-btn"
        aria-label="Download"
        @click.stop="download"
      >
        <i class="bi bi-download" />
      </button>
      <button
        class="fullscreen-btn"
        aria-label="Close"
        @click.stop="emit('close')"
      >
        ×
      </button>
    </div>
    <img
      v-if="viewerKind === 'image'"
      :src="attachment.url"
      :alt="attachment.fileName"
      class="fullscreen-image"
      @click.stop
    />
    <div v-else-if="viewerKind === 'pdf'" class="fullscreen-pdf" @click.stop>
      <div v-if="pdfError" class="pdf-message">
        <i class="bi bi-file-earmark-pdf" />
        <p>The preview is not available for this file.</p>
      </div>
      <template v-else>
        <div v-if="pdfLoading" class="pdf-loading" />
        <div ref="pdfPagesEl" class="pdf-pages" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { downloadObjectUrl, getAttachmentViewerKind } from "../utils/attachments";

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

// pdf.js renders the PDF pages on canvas: mobile Chromium (Android browsers)
// cannot render PDFs inside iframes and only shows its "Open" fallback, so
// the browser's built-in viewer is not an option. Loaded lazily on first use.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const pdfPagesEl = ref(null);
const pdfLoading = ref(false);
const pdfError = ref(false);
let renderToken = 0;
let pdfDoc = null;

watch(
  () => [props.attachment?.url, viewerKind.value],
  async ([url, kind]) => {
    const token = ++renderToken;
    pdfDoc?.destroy();
    pdfDoc = null;
    pdfError.value = false;
    if (kind !== "pdf" || !url) return;
    pdfLoading.value = true;
    try {
      const pdfjs = await loadPdfjs();
      if (token !== renderToken) return;
      const doc = await pdfjs.getDocument({ url }).promise;
      if (token !== renderToken) {
        doc.destroy();
        return;
      }
      pdfDoc = doc;
      await nextTick();
      const container = pdfPagesEl.value;
      if (!container || token !== renderToken) return;
      container.replaceChildren();
      // Render at the container's width (device-pixel sharp) so the pages
      // stack vertically and scroll through the dialog
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = Math.max(container.clientWidth, 320);
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        if (token !== renderToken) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: (cssWidth / base.width) * dpr,
        });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "pdf-page";
        // Scoped CSS never matches elements created imperatively: set the
        // display size inline so pages always fit the panel width
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.setAttribute("aria-label", `Page ${pageNum} of ${doc.numPages}`);
        container.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
        if (token !== renderToken) return;
      }
    } catch {
      if (token === renderToken) pdfError.value = true;
    } finally {
      if (token === renderToken) pdfLoading.value = false;
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  renderToken++;
  pdfDoc?.destroy();
  pdfDoc = null;
});

function download() {
  if (!props.attachment) return;
  downloadObjectUrl(props.attachment.url, props.attachment.fileName);
}
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
  overflow: hidden;
  display: flex;
}

/* The scrollable page stack inside the PDF panel */
.pdf-pages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  align-items: center;
}

.pdf-pages :deep(.pdf-page) {
  display: block;
  box-shadow: var(--shadow-md);
  background: #fff;
}

.pdf-message {
  margin: auto;
  color: #333;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
}

.pdf-message i {
  font-size: var(--text-icon, 3em);
}

.pdf-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2rem;
  height: 2rem;
  margin: -1rem 0 0 -1rem;
  border: 3px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: pdf-spin 0.8s linear infinite;
}

@keyframes pdf-spin {
  to {
    transform: rotate(360deg);
  }
}

.fullscreen-actions {
  position: fixed;
  top: var(--space-md);
  right: var(--space-md);
  z-index: 10000;
  display: flex;
  gap: var(--space-xs);
}

.fullscreen-btn {
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

.fullscreen-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}
</style>
