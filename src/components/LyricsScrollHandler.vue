<template>
  <ScrollOffsetOverlay :offset="currentOffset" :visible="showOverlay" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useCider } from '@ciderapp/pluginkit';
import { useScrollToAdjust } from '../composables/useScrollToAdjust';
import ScrollOffsetOverlay from './ScrollOffsetOverlay.vue';
import { useConfig } from '../main';

const cider = useCider();
const config = useConfig();
const currentOffset = ref(0);
const showOverlay = ref(false);

// Get initial offset value
const getInitialOffset = () => {
  // @ts-ignore
  if (typeof cider.config?.getValue === 'function') {
    // @ts-ignore
    return cider.config.getValue('lyrics.timeOffset') || 0;
  }
  return 0;
};

currentOffset.value = getInitialOffset();

// Clamp offset to range
const clampOffset = (value: number) => {
  return Math.max(-5, Math.min(15, Math.round(value * 10) / 10));
};

// Save offset to config
const saveOffset = (offset: number) => {
  // @ts-ignore
  if (typeof cider.config?.setValue === 'function') {
    // @ts-ignore
    cider.config.setValue('lyrics.timeOffset', offset);
    
    // @ts-ignore
    if (typeof cider.config?.saveConfig === 'function') {
      // @ts-ignore
      cider.config.saveConfig();
      console.log('[ScrollToAdjust] Saved offset:', offset);
    }
  }
};

// Handle offset changes from scroll
const handleOffsetChange = (delta: number) => {
  const newOffset = clampOffset(currentOffset.value + delta);
  currentOffset.value = newOffset;
  saveOffset(newOffset);
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
