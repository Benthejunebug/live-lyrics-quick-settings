<template>
  <ScrollOffsetOverlay :offset="offset" :visible="showOverlay" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useScrollToAdjust } from '../composables/useScrollToAdjust';
import ScrollOffsetOverlay from './ScrollOffsetOverlay.vue';
import { useConfig } from '../main';
import { useLyricsOffsetControls } from '../composables/useLyricsOffsetControls';

const config = useConfig();
const { offset, adjustOffset } = useLyricsOffsetControls(config);
const showOverlay = ref(false);

// Handle offset changes from scroll
const handleOffsetChange = (delta: number) => {
  adjustOffset(delta, { debounced: true });
};

// Handle scroll start/end for visual feedback
const handleScrollStart = () => {
  showOverlay.value = true;
};

const handleScrollEnd = () => {
  showOverlay.value = false;
};

// Setup scroll-to-adjust functionality
useScrollToAdjust({
  enabled: computed(() => config.scrollToAdjust.enabled),
  modifierKey: computed(() => config.scrollToAdjust.modifierKey),
  scrollSensitivity: computed(() => config.scrollToAdjust.scrollSensitivity),
  onOffsetChange: handleOffsetChange,
  onScrollStart: handleScrollStart,
  onScrollEnd: handleScrollEnd,
});
</script>

<style scoped>
/* This component has no visual elements of its own */
</style>
