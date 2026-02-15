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
    <div class="auto-sync-row">
      <button
        class="auto-sync-btn"
        :disabled="autoSyncState !== 'idle'"
        type="button"
        @click="handleAutoSync"
      >
        {{ autoSyncLabel }}
      </button>
      <button
        v-if="undoOffset !== null"
        class="auto-sync-undo"
        type="button"
        @click="handleUndo"
      >
        Undo
      </button>
    </div>
    <p
      v-if="autoSyncMessage"
      class="auto-sync-message"
      :class="{ error: autoSyncIsError }"
    >
      {{ autoSyncMessage }}
    </p>
    <div v-if="debugInfo" class="debug-section">
      <div class="debug-header">
        <span>Debug Info</span>
        <button class="debug-copy" @click="copyDebug">Copy</button>
      </div>
      <pre class="debug-content">{{ JSON.stringify(debugInfo, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed, onUnmounted } from "vue";
import { useCider } from "@ciderapp/pluginkit";
import { runAutoSync } from "../utils/autoSync";

const offset = ref(0);
const cider = useCider();
const menuRef = ref<HTMLElement | null>(null);
const autoSyncState = ref<"idle" | "listening" | "processing">("idle");
const autoSyncMessage = ref("");
const autoSyncIsError = ref(false);
const undoOffset = ref<number | null>(null);
const debugInfo = ref<any>(null);
let undoTimer: number | null = null;

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

const applyOffset = (value: number) => {
  offset.value = clampOffset(value);
  saveOffset();
};

const autoSyncLabel = computed(() => {
  if (autoSyncState.value === "listening") return "Listening...";
  if (autoSyncState.value === "processing") return "Processing...";
  return "Auto Sync";
});

const clearUndo = () => {
  if (undoTimer !== null) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  undoOffset.value = null;
};

const handleUndo = () => {
  if (undoOffset.value === null) return;
  applyOffset(undoOffset.value);
  clearUndo();
};

const handleAutoSync = async (event: MouseEvent) => {
  if (autoSyncState.value !== "idle") return;
  
  // Clear previous state
  autoSyncMessage.value = "";
  autoSyncIsError.value = false;
  debugInfo.value = null; // Hide debug info on new run unless needed
  clearUndo();
  
  const previousOffset = offset.value;
  autoSyncState.value = "listening";

  try {
    const result = await runAutoSync({
      onPhase: (phase) => {
        autoSyncState.value = phase;
      },
    });
    
    applyOffset(result.offsetSeconds);
    const formatted = `${result.offsetSeconds >= 0 ? "+" : ""}${result.offsetSeconds.toFixed(
      1
    )}s`;
    const confidence = Math.round(result.correlation * 100);
    autoSyncMessage.value = `Synced: ${formatted} (${confidence}%)`;
    
    // Store debug info in case user wants to see it (maybe via hidden gesture?)
    // For now we only show it on error or if shift-clicked
    if (event.shiftKey) {
        debugInfo.value = result.debug;
    }

    undoOffset.value = previousOffset;
    undoTimer = setTimeout(() => {
      undoOffset.value = null;
      undoTimer = null;
    }, 10000) as unknown as number;
  } catch (error: any) {
    autoSyncIsError.value = true;
    autoSyncMessage.value = error.message || "Auto Sync failed.";
    
    // Show debug info on error!
    if (error.debug) {
      debugInfo.value = error.debug;
    }
  } finally {
    autoSyncState.value = "idle";
  }
};

const copyDebug = () => {
  if (debugInfo.value) {
    navigator.clipboard.writeText(JSON.stringify(debugInfo.value, null, 2));
  }
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

onUnmounted(() => {
  if (bufferTimeout !== null) {
    clearTimeout(bufferTimeout);
    bufferTimeout = null;
  }
  if (undoTimer !== null) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
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

.auto-sync-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.auto-sync-btn {
  flex: 1;
  background-color: var(--cider-bg-color, #222);
  color: var(--cider-text-color, #eee);
  border: 1px solid var(--cider-border-color, #444);
  border-radius: 10px;
  padding: 6px 10px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}

.auto-sync-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.auto-sync-undo {
  background-color: var(--cider-bg-color, #222);
  color: var(--cider-text-color, #eee);
  border: 1px solid var(--cider-border-color, #444);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.auto-sync-message {
  margin: 0;
  font-size: 11px;
  color: var(--cider-text-color, #ccc);
}

.auto-sync-message.error {
  color: #ff8a8a;
}

.debug-section {
  margin-top: 5px;
  border-top: 1px solid var(--cider-border-color, #444);
  padding-top: 10px;
}

.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
  font-size: 11px;
  font-weight: bold;
  color: var(--cider-text-color, #ccc);
}

.debug-copy {
  background: none;
  border: 1px solid var(--cider-border-color, #555);
  border-radius: 4px;
  color: var(--cider-text-color, #ccc);
  font-size: 10px;
  padding: 2px 6px;
  cursor: pointer;
}

.debug-content {
  background-color: rgba(0,0,0,0.2);
  padding: 8px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 10px;
  color: #aaa;
  overflow-x: auto;
  white-space: pre-wrap;
  max-height: 150px;
  overflow-y: auto;
  margin: 0;
}
</style>
