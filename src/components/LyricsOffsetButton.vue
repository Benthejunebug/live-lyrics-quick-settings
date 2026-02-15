<template>
  <div 
    class="bubble-menu" 
    @wheel.prevent="handleWheel"
    @keydown="handleKeydown"
    @dblclick="resetToZero"
    tabindex="0"
    ref="menuRef"
  >
    <div class="bubble-header">
      <span>Lyrics Offset</span>
      <span class="offset-badge">{{ offset.toFixed(1) }}</span>
    </div>
    <input
      type="range"
      min="-5"
      max="15"
      step="0.1"
      v-model.number="offset"
      @input="updateOffsetClamped"
      class="offset-slider"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import { useCider } from "@ciderapp/pluginkit";

const offset = ref(0);
const cider = useCider();
const menuRef = ref<HTMLElement | null>(null);

// Keyboard input buffer for typing numbers
const keyBuffer = ref("");
let bufferTimeout: number | null = null;

// Helper to get the app-state store
const getAppState = () => {
  // @ts-ignore - accessing Pinia internal Map
  return cider.store?._s?.get("app-state");
};

const clampOffset = (value: number) => {
  return Math.max(-5, Math.min(15, Math.round(value * 10) / 10));
};

const updateOffsetClamped = () => {
  // Clamp the value to range for slider/wheel
  offset.value = clampOffset(offset.value);
  saveOffset();
};



const saveOffset = () => {
  // Use setValue to set the config value
  // @ts-ignore
  if (typeof cider.config?.setValue === 'function') {
    // @ts-ignore
    cider.config.setValue('lyrics.timeOffset', offset.value);
    
    // Then save the config
    // @ts-ignore
    if (typeof cider.config?.saveConfig === 'function') {
      // @ts-ignore
      cider.config.saveConfig();
      console.log("[LyricsOffset] Saved offset:", offset.value);
    }
  }
};

const resetToZero = () => {
  offset.value = 0;
  saveOffset();
};

const handleKeydown = (event: KeyboardEvent) => {
  // Check for number keys (0-9) or minus/hyphen
  if (/^[0-9]$/.test(event.key) || event.key === '-' || event.key === 'Minus') {
    event.preventDefault();
    
    const keyValue = event.key === 'Minus' ? '-' : event.key;
    
    // If there's a timeout, we're in multi-digit entry mode
    const isMultiDigitEntry = bufferTimeout !== null;
    
    // Clear previous timeout
    if (bufferTimeout !== null) {
      clearTimeout(bufferTimeout);
      bufferTimeout = null;
    }
    
    // If we're starting fresh or starting with minus, clear buffer
    if (!isMultiDigitEntry || keyValue === '-') {
      keyBuffer.value = keyValue;
    } else {
      // We're in multi-digit entry mode, append
      keyBuffer.value += keyValue;
    }
    
    // Try to parse the buffer as a number
    const parsedValue = parseFloat(keyBuffer.value);
    if (!isNaN(parsedValue)) {
      offset.value = clampOffset(parsedValue);
      updateOffsetClamped();
    }
    
    // Set timeout to allow multi-digit entry (500ms window)
    bufferTimeout = setTimeout(() => {
      keyBuffer.value = "";
      bufferTimeout = null;
    }, 500) as unknown as number;
  }
  // Backspace to clear buffer
  else if (event.key === 'Backspace') {
    event.preventDefault();
    keyBuffer.value = "";
    if (bufferTimeout !== null) {
      clearTimeout(bufferTimeout);
      bufferTimeout = null;
    }
  }
};

const handleWheel = (event: WheelEvent) => {
  // Scroll up = increase, scroll down = decrease
  const delta = -Math.sign(event.deltaY) * 0.1;
  offset.value = clampOffset(offset.value + delta);
  updateOffsetClamped();
};

onMounted(() => {
  // Get initial value using getValue
  // @ts-ignore
  if (typeof cider.config?.getValue === 'function') {
    // @ts-ignore
    const initialValue = cider.config.getValue('lyrics.timeOffset');
    offset.value = initialValue || 0;
    
    // Watch for external changes to the offset
    const appState = getAppState();
    if (appState?.config?.lyrics) {
      watch(
        () => appState.config.lyrics.timeOffset,
        (newValue) => {
          if (newValue !== offset.value) {
            offset.value = newValue;
            console.log("[LyricsOffset] Synced from settings:", newValue);
          }
        }
      );
    }
  }
  
  // Auto-focus the menu so keyboard shortcuts work immediately
  nextTick(() => {
    menuRef.value?.focus();
  });
});

</script>

<style scoped>
.bubble-menu {
  /* Removed absolute positioning to let the component flow naturally in the container */
  width: 340px;
  background-color: var(--cider-bg-color, #222);
  border: 1px solid var(--cider-border-color, #444);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 18px;
  outline: none;
}

.bubble-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: var(--cider-text-color, #eee);
  font-weight: bold;
  margin-bottom: 0;
}

.offset-badge {
  background-color: var(--cider-accent-color, #fa586a);
  color: white;
  padding: 6px 14px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: bold;
  min-width: 45px;
  text-align: center;
  display: inline-block;
}

.offset-slider {
  width: 100%;
  height: 6px;
  accent-color: var(--cider-accent-color, #fa586a);
  cursor: pointer;
}
</style>
