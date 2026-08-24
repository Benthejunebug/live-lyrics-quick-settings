<template>
  <section class="control-center" aria-label="Settings Shortcuts Control Center">
    <header class="center-header">
      <div>
        <span class="eyebrow">Live Lyrics Quick Settings</span>
        <h1>Settings Shortcuts</h1>
      </div>
      <div class="header-actions">
        <span v-if="saveState === 'saved'" class="save-state">Saved</span>
        <button class="ghost-button" type="button" @click="emit('close')">Close</button>
      </div>
    </header>

    <nav class="tabs" aria-label="Shortcut groups">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <main class="tab-body">
      <section v-if="activeTab === 'lyrics'" class="panel-section">
        <div class="section-heading">
          <div>
            <h2>Lyrics Offset</h2>
            <p>Fine tune the live lyrics timing and keep the existing Auto Sync workflow close by.</p>
          </div>
          <span class="value-pill">{{ formattedOffset }}</span>
        </div>

        <input
          class="wide-slider"
          type="range"
          min="-5"
          max="15"
          step="0.1"
          :value="offset"
          @input="handleLyricsOffsetInput"
        />

        <div class="action-row">
          <button class="ghost-button" type="button" @click="resetOffset">
            Reset Offset
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

        <div v-if="debugInfo" class="debug-panel">
          <div class="debug-heading">
            <h3>Auto Sync Debug</h3>
            <button class="ghost-button small" type="button" @click="copyDebug">Copy Debug</button>
          </div>
          <pre>{{ JSON.stringify(debugInfo, null, 2) }}</pre>
        </div>

        <div class="fixed-setting">
          <div>
            <strong>{{ buttonPlacementShortcut.label }}</strong>
            <span>Fixed for v1 because the alternate Mojave placement is guarded by startup safety.</span>
          </div>
          <code>{{ getFormattedShortcutValue(buttonPlacementShortcut) }}</code>
        </div>
      </section>

      <section v-else-if="activeTab === 'scroll'" class="panel-section">
        <div class="section-heading">
          <div>
            <h2>Scroll to Adjust</h2>
            <p>Hold a modifier over the lyrics view and scroll to nudge timing without opening settings.</p>
          </div>
        </div>

        <label class="toggle-row">
          <span>
            <strong>{{ scrollEnabledShortcut.label }}</strong>
            <small>Enable global lyrics-view wheel adjustments.</small>
          </span>
          <input
            type="checkbox"
            :checked="Boolean(getShortcutValue(scrollEnabledShortcut))"
            @change="setBooleanShortcut(scrollEnabledShortcut, $event)"
          />
        </label>

        <label class="field-row">
          <span>{{ scrollModifierShortcut.label }}</span>
          <select
            :value="String(getShortcutValue(scrollModifierShortcut))"
            @change="setStringShortcut(scrollModifierShortcut, $event)"
          >
            <option
              v-for="option in scrollModifierShortcut.options"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field-row slider-row">
          <span>{{ scrollSensitivityShortcut.label }}</span>
          <strong>{{ getNumberLabel(scrollSensitivityShortcut) }}</strong>
          <input
            type="range"
            min="0.05"
            max="0.5"
            step="0.05"
            :value="getNumberValue(scrollSensitivityShortcut)"
            @input="setNumberShortcut(scrollSensitivityShortcut, $event, true)"
          />
        </label>
      </section>

      <section v-else-if="activeTab === 'companion'" class="panel-section">
        <div class="section-heading">
          <div>
            <h2>Companion Mic</h2>
            <p>Use the local macOS companion when the Cider host cannot request microphone access.</p>
          </div>
        </div>

        <label class="toggle-row">
          <span>
            <strong>{{ companionEnabledShortcut.label }}</strong>
            <small>Prefer the localhost mic stream before falling back to browser mic capture.</small>
          </span>
          <input
            type="checkbox"
            :checked="Boolean(getShortcutValue(companionEnabledShortcut))"
            @change="setBooleanShortcut(companionEnabledShortcut, $event)"
          />
        </label>

        <label class="field-row">
          <span>{{ companionUrlShortcut.label }}</span>
          <input
            type="text"
            :value="String(getShortcutValue(companionUrlShortcut))"
            @change="setStringShortcut(companionUrlShortcut, $event)"
          />
        </label>

        <label class="field-row">
          <span>{{ companionTimeoutShortcut.label }}</span>
          <input
            type="number"
            min="250"
            max="5000"
            step="250"
            :value="Number(getShortcutValue(companionTimeoutShortcut))"
            @change="setNumberShortcut(companionTimeoutShortcut, $event, false)"
          />
        </label>

        <div class="action-row">
          <button
            class="primary-button"
            type="button"
            :disabled="companionTestState === 'testing'"
            @click="testCompanion"
          >
            {{ companionTestState === "testing" ? "Checking..." : "Test Connection" }}
          </button>
          <p
            v-if="companionTestMessage"
            class="status-message"
            :class="{ error: companionTestState === 'error' }"
          >
            {{ companionTestMessage }}
          </p>
        </div>
      </section>

      <section v-else class="panel-section advanced-section">
        <div class="section-heading">
          <div>
            <h2>Advanced</h2>
            <p>Read-only Cider config discovery. Copy paths or redacted values without editing internals.</p>
          </div>
        </div>

        <label class="search-row">
          <span>Search config</span>
          <input v-model="explorerSearch" type="search" placeholder="lyrics.timeOffset" />
        </label>

        <div class="explorer-list">
          <details
            v-for="group in groupedConfigEntries"
            :key="group.section"
            open
            class="explorer-group"
          >
            <summary>
              <span>{{ group.section }}</span>
              <small>{{ group.entries.length }}</small>
            </summary>
            <button
              v-for="entry in group.entries"
              :key="entry.path"
              class="explorer-entry"
              type="button"
              :style="{ paddingLeft: `${12 + entry.depth * 12}px` }"
              @click="copyExplorerEntry(entry)"
            >
              <code>{{ entry.path }}</code>
              <span>{{ entry.text }}</span>
            </button>
          </details>

          <p v-if="configEntries.length === 0" class="empty-state">
            No matching config paths.
          </p>
        </div>
      </section>
    </main>
  </section>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useConfig } from "../main";
import { useLyricsOffsetControls } from "../composables/useLyricsOffsetControls";
import { useSettingsShortcuts } from "../composables/useSettingsShortcuts";
import type { SettingsShortcut, ShortcutGroup } from "../utils/settingsShortcuts";
import { getShortcutById } from "../utils/settingsShortcuts";

const emit = defineEmits<{
  close: [];
}>();

type TabId = Exclude<ShortcutGroup, "advanced"> | "advanced";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "lyrics", label: "Lyrics" },
  { id: "scroll", label: "Scroll" },
  { id: "companion", label: "Companion" },
  { id: "advanced", label: "Advanced" },
];

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
  resetOffset,
  runAutoOffsetSync,
  handleUndo,
  copyDebug,
} = useLyricsOffsetControls(config);
const {
  saveState,
  explorerSearch,
  configEntries,
  groupedConfigEntries,
  companionTestState,
  companionTestMessage,
  getShortcutValue,
  setShortcutValue,
  getFormattedShortcutValue,
  copyExplorerEntry,
  testCompanionConnection,
} = useSettingsShortcuts(config as unknown as Record<string, unknown>);
const activeTab = ref<TabId>("lyrics");
const numberDrafts = ref<Record<string, number>>({});
const numberTimers = new Map<string, number>();

const requireShortcut = (id: string) => {
  const shortcut = getShortcutById(id);
  if (!shortcut) {
    throw new Error(`Missing settings shortcut: ${id}`);
  }
  return shortcut;
};

const buttonPlacementShortcut = requireShortcut("button.location");
const scrollEnabledShortcut = requireShortcut("scroll.enabled");
const scrollModifierShortcut = requireShortcut("scroll.modifierKey");
const scrollSensitivityShortcut = requireShortcut("scroll.sensitivity");
const companionEnabledShortcut = requireShortcut("companion.enabled");
const companionUrlShortcut = requireShortcut("companion.url");
const companionTimeoutShortcut = requireShortcut("companion.timeout");

const handleLyricsOffsetInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  applyOffset(Number(target.value), { debounced: true });
};

const setBooleanShortcut = (shortcut: SettingsShortcut, event: Event) => {
  const target = event.target as HTMLInputElement;
  setShortcutValue(shortcut, target.checked);
};

const setStringShortcut = (shortcut: SettingsShortcut, event: Event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  setShortcutValue(shortcut, target.value);
};

const setNumberShortcut = (shortcut: SettingsShortcut, event: Event, debounced: boolean) => {
  const target = event.target as HTMLInputElement;
  const nextValue = Number(target.value);
  numberDrafts.value = {
    ...numberDrafts.value,
    [shortcut.id]: nextValue,
  };

  const save = () => {
    setShortcutValue(shortcut, nextValue);
    const rest = { ...numberDrafts.value };
    delete rest[shortcut.id];
    numberDrafts.value = rest;
    numberTimers.delete(shortcut.id);
  };

  if (!debounced) {
    save();
    return;
  }

  const existingTimer = numberTimers.get(shortcut.id);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  numberTimers.set(shortcut.id, setTimeout(save, 150) as unknown as number);
};

const getNumberValue = (shortcut: SettingsShortcut) => {
  return numberDrafts.value[shortcut.id] ?? Number(getShortcutValue(shortcut) || 0);
};

const getNumberLabel = (shortcut: SettingsShortcut) => {
  const value = getNumberValue(shortcut);
  return shortcut.formatter ? shortcut.formatter(value) : String(value);
};

const testCompanion = () => {
  const url = String(getShortcutValue(companionUrlShortcut));
  const timeout = Number(getShortcutValue(companionTimeoutShortcut));
  testCompanionConnection(url, timeout);
};

onUnmounted(() => {
  for (const timer of numberTimers.values()) {
    clearTimeout(timer);
  }
  numberTimers.clear();
});
</script>

<style scoped>
:global(dialog.settings-shortcuts-modal) {
  width: min(900px, calc(100vw - 32px));
  max-width: min(900px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 8px;
}

:global(dialog.settings-shortcuts-modal::backdrop) {
  background: rgba(0, 0, 0, 0.54);
  backdrop-filter: blur(4px);
}

.control-center {
  display: grid;
  grid-template-rows: auto auto 1fr;
  max-height: calc(100vh - 48px);
  overflow: hidden;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: var(--qDarkHUD, var(--cider-bg-color, #202124));
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.14)));
  border-radius: var(--genericBorderRadius, 8px);
  /* --qDarkHUD is a translucent HUD surface in Cider 4; blur what shows through. */
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.46);
}

.center-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.12)));
}

.eyebrow {
  display: block;
  margin-bottom: 4px;
  color: var(--systemSecondary, var(--cider-subtext-color, rgba(255, 255, 255, 0.62)));
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: 0;
}

h2 {
  font-size: 16px;
  line-height: 1.3;
  letter-spacing: 0;
}

h3 {
  font-size: 13px;
  line-height: 1.3;
  letter-spacing: 0;
}

p,
small {
  color: var(--systemSecondary, var(--cider-subtext-color, rgba(255, 255, 255, 0.65)));
  font-size: 12px;
  line-height: 1.45;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.save-state {
  color: #78d48f;
  font-size: 12px;
  font-weight: 800;
}

.tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.12)));
}

button,
input,
select {
  font: inherit;
}

button {
  border-radius: 8px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.tabs button {
  min-height: 34px;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 800;
}

.tabs button.active {
  background: rgba(250, 88, 106, 0.16);
  border-color: rgba(250, 88, 106, 0.44);
}

.tab-body {
  min-height: 0;
  overflow: auto;
  padding: 20px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.section-heading p {
  max-width: 620px;
  margin-top: 5px;
}

.value-pill {
  min-width: 72px;
  padding: 7px 10px;
  color: #fff;
  background: var(--keyColor, var(--cider-accent-color, #fa586a));
  border-radius: 8px;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
}

.wide-slider,
.slider-row input[type="range"] {
  width: 100%;
  accent-color: var(--keyColor, var(--cider-accent-color, #fa586a));
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.primary-button,
.ghost-button {
  min-height: 34px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
}

.primary-button {
  color: #fff;
  background: var(--keyColor, var(--cider-accent-color, #fa586a));
  border: 1px solid transparent;
}

.ghost-button {
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.14)));
}

.ghost-button.small {
  min-height: 28px;
  padding: 5px 9px;
}

.status-message {
  color: var(--systemSecondary, var(--cider-subtext-color, rgba(255, 255, 255, 0.68)));
}

.status-message.error {
  color: #ff9c9c;
}

.debug-panel,
.fixed-setting,
.toggle-row,
.field-row,
.search-row {
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.12)));
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}

.debug-panel {
  overflow: hidden;
}

.debug-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.12)));
}

pre {
  max-height: 220px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  color: #cbd4df;
  background: rgba(0, 0, 0, 0.22);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.fixed-setting,
.toggle-row,
.field-row,
.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px;
}

.fixed-setting span,
.toggle-row small {
  display: block;
  margin-top: 3px;
}

code {
  color: #dfe7f2;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  word-break: break-all;
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--keyColor, var(--cider-accent-color, #fa586a));
}

input[type="text"],
input[type="number"],
input[type="search"],
select {
  min-width: min(360px, 45vw);
  min-height: 34px;
  padding: 6px 9px;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.16)));
  border-radius: 8px;
  outline: none;
}

input:focus,
select:focus {
  border-color: rgba(250, 88, 106, 0.78);
}

.slider-row {
  grid-template-columns: minmax(130px, auto) auto minmax(180px, 1fr);
}

.advanced-section {
  gap: 14px;
}

.search-row {
  grid-template-columns: auto minmax(240px, 1fr);
}

.search-row input {
  width: 100%;
  min-width: 0;
}

.explorer-list {
  max-height: min(480px, calc(100vh - 320px));
  overflow: auto;
  border: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.12)));
  border-radius: 8px;
}

.explorer-group + .explorer-group {
  border-top: 1px solid var(--systemQuaternary, var(--cider-border-color, rgba(255, 255, 255, 0.1)));
}

summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.explorer-entry {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(140px, 1fr);
  gap: 12px;
  padding-top: 8px;
  padding-right: 12px;
  padding-bottom: 8px;
  color: var(--systemPrimary, var(--cider-text-color, #f4f6fb));
  background: transparent;
  border: 0;
  border-radius: 0;
  text-align: left;
}

.explorer-entry:hover {
  background: rgba(255, 255, 255, 0.05);
}

.explorer-entry span {
  min-width: 0;
  overflow: hidden;
  color: var(--systemSecondary, var(--cider-subtext-color, rgba(255, 255, 255, 0.65)));
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  padding: 14px;
}

@media (max-width: 680px) {
  .center-header,
  .section-heading,
  .action-row {
    align-items: stretch;
    flex-direction: column;
  }

  .tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fixed-setting,
  .toggle-row,
  .field-row,
  .slider-row,
  .search-row,
  .explorer-entry {
    grid-template-columns: 1fr;
  }

  input[type="text"],
  input[type="number"],
  input[type="search"],
  select {
    width: 100%;
    min-width: 0;
  }
}
</style>
