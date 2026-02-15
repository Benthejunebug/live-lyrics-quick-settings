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
      <span class="offset-badge">{{ offset.toFixed(1) }}s</span>
    </div>
    
    <div class="slider-container">
      <input
        type="range"
        min="-5"
        max="15"
        step="0.1"
        v-model.number="offset"
        @input="updateOffsetClamped"
        class="offset-slider"
      />
      <div class="slider-labels">
        <span>-5s</span>
        <span>0s</span>
        <span>+15s</span>
      </div>
    </div>

    <div class="separator"></div>

    <!-- Auto Sync Section -->
    <div class="auto-sync-section">
      <button
        class="cider-btn-ghost"
        :class="{ 'is-active': autoSyncState === 'listening' || autoSyncState === 'processing' }"
        :disabled="autoSyncState !== 'idle' && autoSyncState !== 'done' && autoSyncState !== 'error'"
        @click="handleAutoSync"
      >
        <div class="btn-content">
          <span class="icon">🎙️</span>
          <span v-if="autoSyncState === 'idle' || autoSyncState === 'error' || autoSyncState === 'done'">Auto Sync</span>
          <span v-else-if="autoSyncState === 'listening'">Listening...</span>
          <span v-else-if="autoSyncState === 'processing'">Processing...</span>
        </div>
      </button>

      <transition name="fade">
        <div v-if="showUndo" class="undo-container">
          <button class="undo-btn" @click="handleUndo">
            ↩ Undo change
          </button>
        </div>
      </transition>
    </div>

    <transition name="slide-up">
      <div v-if="autoSyncMessage" class="status-message" :class="messageType">
        {{ autoSyncMessage }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from "vue";
import { useCider, useCiderAudio } from "@ciderapp/pluginkit";
import { runAutoSync } from "../utils/autoSync";

const offset = ref(0);
const cider = useCider();
const menuRef = ref<HTMLElement | null>(null);

// Keyboard input buffer
const keyBuffer = ref("");
let bufferTimeout: number | null = null;

// Auto Sync state
const autoSyncState = ref<'idle' | 'listening' | 'processing' | 'done' | 'error'>('idle');
const autoSyncMessage = ref('');
const messageType = ref<'info' | 'success' | 'error'>('info');
const undoOffset = ref<number | null>(null);
const undoTimer = ref<number | null>(null);

const showUndo = computed(() => autoSyncState.value === 'done' && undoTimer.value !== null);

// Helper to get app-state
const getAppState = () => {
  // @ts-ignore
  return cider.store?._s?.get("app-state");
};

const clampOffset = (value: number) => {
  return Math.max(-5, Math.min(15, Math.round(value * 10) / 10));
};

const updateOffsetClamped = () => {
  offset.value = clampOffset(offset.value);
  saveOffset();
};

const saveOffset = () => {
  // @ts-ignore
  if (typeof cider.config?.setValue === 'function') {
    // @ts-ignore
    cider.config.setValue('lyrics.timeOffset', offset.value);
    // @ts-ignore
    if (typeof cider.config?.saveConfig === 'function') cider.config.saveConfig();
  }
};

const resetToZero = () => {
  offset.value = 0;
  saveOffset();
};

// --- Auto Sync ---
const handleAutoSync = async () => {
  if (autoSyncState.value === 'listening' || autoSyncState.value === 'processing') return;

  // Clear previous undo/messages
  if (undoTimer.value !== null) {
    clearTimeout(undoTimer.value);
    undoTimer.value = null;
  }
  autoSyncMessage.value = '';
  messageType.value = 'info';

  const audio = useCiderAudio();
  // @ts-ignore
  const ctx: AudioContext | undefined = audio?.context;
  // @ts-ignore
  const source: AudioNode | undefined = audio?.source ?? audio?.audioNodes?.gainNode;

  if (!ctx || !source) {
    autoSyncState.value = 'error';
    messageType.value = 'error';
    autoSyncMessage.value = 'Audio unavailable (is music playing?)';
    scheduleMessageClear(4000);
    return;
  }

  undoOffset.value = offset.value;

  const result = await runAutoSync(ctx, source, 1500, (status) => {
    autoSyncState.value = status;
  });

  if (result.ok) {
    offset.value = result.offsetSeconds;
    saveOffset();
    autoSyncState.value = 'done';
    messageType.value = 'success';
    autoSyncMessage.value = `Offset: ${result.offsetSeconds > 0 ? '+' : ''}${result.offsetSeconds.toFixed(1)}s`;
    
    // Undo window: 10s
    undoTimer.value = setTimeout(() => {
      undoTimer.value = null;
      undoOffset.value = null;
      if (autoSyncState.value === 'done') autoSyncState.value = 'idle';
      autoSyncMessage.value = '';
    }, 10000) as unknown as number;
  } else {
    autoSyncState.value = 'error';
    messageType.value = 'error';
    autoSyncMessage.value = result.message;
    scheduleMessageClear(6000);
  }
};

const handleUndo = () => {
  if (undoOffset.value !== null) {
    offset.value = undoOffset.value;
    saveOffset();
    undoOffset.value = null;
  }
  if (undoTimer.value !== null) {
    clearTimeout(undoTimer.value);
    undoTimer.value = null;
  }
  autoSyncMessage.value = 'Undone';
  messageType.value = 'info';
  autoSyncState.value = 'idle';
  scheduleMessageClear(2000);
};

const scheduleMessageClear = (ms: number) => {
  setTimeout(() => {
    autoSyncMessage.value = '';
    if (autoSyncState.value === 'error') autoSyncState.value = 'idle';
  }, ms);
};

// ... keyboard and wheel handlers stay same ...
const handleKeydown = (event: KeyboardEvent) => {
  if (/^[0-9]$/.test(event.key) || event.key === '-' || event.key === 'Minus') {
    event.preventDefault();
    const keyValue = event.key === 'Minus' ? '-' : event.key;
    const isMultiDigitEntry = bufferTimeout !== null;
    
    if (bufferTimeout !== null) {
      clearTimeout(bufferTimeout);
      bufferTimeout = null;
    }
    
    if (!isMultiDigitEntry || keyValue === '-') keyBuffer.value = keyValue;
    else keyBuffer.value += keyValue;
    
    const parsedValue = parseFloat(keyBuffer.value);
    if (!isNaN(parsedValue)) {
      offset.value = clampOffset(parsedValue);
      updateOffsetClamped();
    }
    
    bufferTimeout = setTimeout(() => {
      keyBuffer.value = "";
      bufferTimeout = null;
    }, 500) as unknown as number;
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    keyBuffer.value = "";
    if (bufferTimeout !== null) clearTimeout(bufferTimeout);
  }
};

const handleWheel = (event: WheelEvent) => {
  const delta = -Math.sign(event.deltaY) * 0.1;
  offset.value = clampOffset(offset.value + delta);
  updateOffsetClamped();
};

onMounted(() => {
  // @ts-ignore
  if (typeof cider.config?.getValue === 'function') {
    // @ts-ignore
    const initialValue = cider.config.getValue('lyrics.timeOffset');
    offset.value = initialValue || 0;
    
    const appState = getAppState();
    if (appState?.config?.lyrics) {
      watch(() => appState.config.lyrics.timeOffset, (newValue) => {
        if (newValue !== offset.value) offset.value = newValue;
      });
    }
  }
  nextTick(() => menuRef.value?.focus());
});
</script>

<style scoped>
.bubble-menu {
  width: 320px;
  background-color: var(--cider-bg-color, #1a1a1a);
  border: 1px solid var(--cider-border-color, #333);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 16px;
  outline: none;
  font-family: inherit;
  color: var(--cider-text-color, #eee);
}

.bubble-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
}

.offset-badge {
  background-color: var(--cider-accent-color, #fa586a);
  color: white;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  min-width: 48px;
  text-align: center;
}

.slider-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.offset-slider {
  width: 100%;
  height: 4px;
  accent-color: var(--cider-accent-color, #fa586a);
  cursor: pointer;
  border-radius: 2px;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 500;
  padding: 0 2px;
}

.separator {
  height: 1px;
  background-color: var(--cider-border-color, #333);
  width: 100%;
  opacity: 0.5;
}

/* Auto Sync Section */
.auto-sync-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cider-btn-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--cider-border-color, #444);
  border-radius: 8px;
  color: var(--cider-text-color, #eee);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cider-btn-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.3);
}

.cider-btn-ghost:disabled {
  opacity: 0.5;
  cursor: default;
}

.cider-btn-ghost.is-active {
  background: var(--cider-accent-color, #fa586a);
  border-color: var(--cider-accent-color, #fa586a);
  color: white;
}

.btn-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon {
  font-size: 14px;
}

.undo-container {
  display: flex;
  justify-content: center;
}

.undo-btn {
  background: none;
  border: none;
  color: var(--cider-accent-color, #fa586a);
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  opacity: 0.9;
  padding: 4px;
}

.undo-btn:hover {
  text-decoration: underline;
  opacity: 1;
}

/* Status Messages */
.status-message {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  text-align: center;
  line-height: 1.4;
}

.status-message.info {
  background: rgba(255, 255, 255, 0.05);
  color: #ccc;
}

.status-message.success {
  background: rgba(50, 200, 100, 0.15);
  color: #4ade80;
  border: 1px solid rgba(50, 200, 100, 0.2);
}

.status-message.error {
  background: rgba(255, 80, 80, 0.15);
  color: #ff6b6b;
  border: 1px solid rgba(255, 80, 80, 0.2);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.2s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(5px);
}
</style>
