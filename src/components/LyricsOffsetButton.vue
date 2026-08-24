<template>
  <div
    ref="menuRef"
    class="settings-bubble"
    tabindex="0"
    @wheel.prevent="handleWheel"
    @keydown="handleKeydown"
    @dblclick="resetOffset"
  >
    <div class="bubble-header">
      <div>
        <span class="eyebrow">Settings Shortcuts</span>
        <h2>Lyrics Offset</h2>
      </div>
      <span class="offset-badge">{{ formattedOffset }}</span>
    </div>

    <input
      class="offset-slider"
      type="range"
      min="-5"
      max="15"
      step="0.1"
      :value="offset"
      @input="handleOffsetInput"
    />

    <div class="quick-actions">
      <button class="ghost-button" type="button" @click="resetOffset">
        Reset
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="autoSyncState !== 'idle'"
        @click="runAutoOffsetSync"
      >
        {{ autoSyncLabel }}
      </button>
      <button
        v-if="undoOffset !== null"
        class="ghost-button"
        type="button"
        @click="handleUndo"
      >
        Undo
      </button>
    </div>

    <p
      v-if="autoSyncMessage"
      class="status-message"
      :class="{ error: autoSyncIsError }"
    >
      {{ autoSyncMessage }}
    </p>

    <div v-if="debugInfo" class="debug-row">
      <span>Debug data available</span>
      <button class="link-button" type="button" @click="copyDebug">Copy</button>
    </div>

    <button class="open-center-button" type="button" @click="requestSettingsShortcutsControlCenter">
      Open Control Center
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { useConfig } from "../main";
import { useLyricsOffsetControls } from "../composables/useLyricsOffsetControls";
import { requestSettingsShortcutsControlCenter } from "../utils/controlCenterEvents";

const config = useConfig();
const {
  offset,
  formattedOffset,
  autoSyncState,
  autoSyncLabel,
  autoSyncMessage,
  autoSyncIsError,
  undoOffset,
  debugInfo,
  applyOffset,
  adjustOffset,
  resetOffset,
  runAutoOffsetSync,
  handleUndo,
  copyDebug,
} = useLyricsOffsetControls(config);
const menuRef = ref<HTMLElement | null>(null);
const keyBuffer = ref("");
let bufferTimeout: number | null = null;

const clearKeyBuffer = () => {
  keyBuffer.value = "";
  if (bufferTimeout !== null) {
    clearTimeout(bufferTimeout);
    bufferTimeout = null;
  }
};

const handleOffsetInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  applyOffset(Number(target.value), { debounced: true });
};

const handleWheel = (event: WheelEvent) => {
  const delta = -Math.sign(event.deltaY) * 0.1;
  adjustOffset(delta, { debounced: true });
};

const handleKeydown = (event: KeyboardEvent) => {
  if (/^[0-9]$/.test(event.key) || event.key === "-" || event.key === "Minus") {
    event.preventDefault();
    const keyValue = event.key === "Minus" ? "-" : event.key;
    const isMultiDigitEntry = bufferTimeout !== null;

    if (bufferTimeout !== null) {
      clearTimeout(bufferTimeout);
      bufferTimeout = null;
    }

    if (!isMultiDigitEntry || keyValue === "-") {
      keyBuffer.value = keyValue;
    } else {
      keyBuffer.value += keyValue;
    }

    const parsedValue = parseFloat(keyBuffer.value);
    if (!Number.isNaN(parsedValue)) {
      applyOffset(parsedValue, { debounced: true });
    }

    bufferTimeout = setTimeout(clearKeyBuffer, 500) as unknown as number;
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    clearKeyBuffer();
  }
};

onMounted(() => {
  nextTick(() => {
    menuRef.value?.focus();
  });
});

onUnmounted(() => {
  clearKeyBuffer();
});
</script>

<style scoped>
.settings-bubble {
  width: 340px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: var(--qDarkHUD, var(--cider-bg-color, #202124));
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.14)));
  border-radius: var(--genericBorderRadius, 8px);
  /* --qDarkHUD is a translucent HUD surface in Cider 4; blur what shows through. */
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
  outline: none;
}

.bubble-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.eyebrow {
  display: block;
  margin-bottom: 4px;
  color: var(--systemSecondary, var(--cider-subtext-color, rgba(255, 255, 255, 0.62)));
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: 0;
}

.offset-badge {
  min-width: 64px;
  padding: 6px 8px;
  color: #fff;
  background: var(--keyColor, var(--cider-accent-color, #fa586a));
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.2;
  font-weight: 800;
  text-align: center;
}

.offset-slider {
  width: 100%;
  height: 6px;
  accent-color: var(--keyColor, var(--cider-accent-color, #fa586a));
  cursor: pointer;
}

.quick-actions {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
}

button {
  min-height: 32px;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.primary-button,
.open-center-button {
  color: #fff;
  background: var(--keyColor, var(--cider-accent-color, #fa586a));
  border: 1px solid transparent;
}

.primary-button {
  padding: 7px 12px;
}

.ghost-button {
  padding: 7px 10px;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.14)));
}

.open-center-button {
  width: 100%;
  padding: 8px 12px;
}

.status-message {
  margin: 0;
  color: var(--systemSecondary, var(--cider-subtext-color, rgba(255, 255, 255, 0.68)));
  font-size: 12px;
  line-height: 1.4;
}

.status-message.error {
  color: #ff9c9c;
}

.debug-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  color: var(--systemSecondary, var(--cider-subtext-color, rgba(255, 255, 255, 0.68)));
  font-size: 12px;
}

.link-button {
  min-height: 26px;
  padding: 3px 8px;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: transparent;
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.14)));
}
</style>
