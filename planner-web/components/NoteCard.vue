<template>
  <div class="item-card note-card" @click.stop="$emit('click', note)">
    <div class="card-accent" />
    <div class="card-body">
      <header>
        <div class="card-title-row">
          <span class="item-icon"><i class="bi bi-sticky" /></span>
          <span class="item-title">{{ note.title }}</span>
        </div>
        <small class="card-date">{{ formatDate(note.dateCreated) }}</small>
      </header>
      <p v-if="note.description" class="card-desc">
        {{ truncate(note.description, 150) }}
      </p>
      <footer
        v-if="
          (note.labels && note.labels.length) ||
          (note.comments && note.comments.length)
        "
      >
        <span v-for="l in note.labels" :key="l" class="label-tag">{{ l }}</span>
        <small
          v-if="note.comments && note.comments.length"
          class="comment-count"
        >
          <i class="bi bi-chat" /> {{ note.comments.length }}
        </small>
      </footer>
    </div>
  </div>
</template>

<script setup>
defineProps({
  note: { type: Object, required: true },
});

defineEmits(["click"]);

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString();
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.substring(0, max) + "..." : text;
}
</script>

<style scoped>
.card-date {
  color: var(--pico-muted-color);
  font-size: 0.78em;
}

.card-desc {
  margin-top: var(--space-xs, 4px);
  font-size: 0.85em;
  color: var(--pico-muted-color);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.comment-count {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--pico-muted-color);
  margin-left: auto;
}
</style>
