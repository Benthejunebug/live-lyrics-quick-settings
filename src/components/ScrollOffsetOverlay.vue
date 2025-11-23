<template>
  <Transition name="fade">
    <div v-if="isVisible" class="scroll-offset-overlay">
      <div class="overlay-content">
        <span class="offset-label">Offset:</span>
        <span class="offset-value">{{ formattedOffset }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  offset: number;
  visible: boolean;
}>();

const isVisible = computed(() => props.visible);

const formattedOffset = computed(() => {
  const value = props.offset.toFixed(1);
  const sign = props.offset >= 0 ? '+' : '';
  return `${sign}${value}s`;
});
</script>

<style scoped>
.scroll-offset-overlay {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  pointer-events: none;
}

.overlay-content {
  background-color: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.offset-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}

.offset-value {
  font-size: 18px;
  font-weight: bold;
  color: var(--cider-accent-color, #fa586a);
  min-width: 60px;
  text-align: center;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
