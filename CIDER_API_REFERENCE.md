# Cider PluginKit & Config API Reference

A comprehensive guide to working with Cider's plugin system, configuration API, and internal stores based on real-world implementation.

## Table of Contents
- [PluginKit API](#pluginkit-api)
- [Cider Config API](#cider-config-api)
- [Store Architecture](#store-architecture)
- [Real-time Sync](#real-time-sync)
- [Custom UI Elements](#custom-ui-elements)

---

## PluginKit API

### Core Imports

```typescript
import {
  definePluginContext,
  addCustomButton,
  addMainMenuEntry,
  addMediaItemContextMenuEntry,
  addImmersiveMenuEntry,
  addImmersiveLayout,
  createModal,
  useCider,
  useCiderAudio,
  useRouter,
  useMusicKit,
} from "@ciderapp/pluginkit";
```

### useCider Hook

The primary way to access Cider's internal state and configuration.

```typescript
const cider = useCider();

// Available properties:
cider.RPC        // Discord RPC
cider.app        // Vue app instance
cider.router     // Vue router
cider.store      // Pinia store (root)
cider.config     // Config API ⭐ (see below)
```

### Custom Buttons

Add buttons to various locations in the Cider UI.

```typescript
addCustomButton({
  element: "💬",                    // Icon/emoji
  location: "chrome-top/right",      // Position
  title: "Lyrics Offset",           // Tooltip
  menuElement: customElementName("lyrics-offset-button"),  // Custom element to show
});
```

**Available Locations:**
- `chrome-top/left`
- `chrome-top/right`
- More locations in the chrome area

---

## Cider Config API

### Reading Configuration

```typescript
// Get a config value by path
const value = cider.config.getValue('lyrics.timeOffset');
const volume = cider.config.getValue('audio.volume');
```

### Writing Configuration

```typescript
// Set a config value
cider.config.setValue('lyrics.timeOffset', 2.5);

// IMPORTANT: Changes are NOT persisted automatically!
```

### Saving Configuration

```typescript
// Persist all config changes to disk
cider.config.saveConfig();
```

### Complete Example

```typescript
const updateSetting = (value: number) => {
  // 1. Set the value
  cider.config.setValue('lyrics.timeOffset', value);
  
  // 2. Save to disk
  cider.config.saveConfig();
  
  console.log("Config saved!");
};
```

### Other Config Methods

```typescript
// Get a reactive reference to a config value
const volumeRef = cider.config.getRef('audio.volume');

// Available methods discovered:
// - getValue(path: string)
// - setValue(path: string, value: any)
// - getRef(path: string)
// - saveConfig()
```

---

## Store Architecture

### Pinia Store Structure

Cider uses Pinia for state management. Stores are accessed via an internal Map.

```typescript
// Access the root Pinia store
const rootStore = cider.store;

// Stores are stored in a Map called _s
const appStateStore = cider.store._s.get("app-state");
```

### Available Stores

```typescript
// Discovered stores (via _s Map):
"app-state"       // Main application state & config
"audio-labs"      // Audio experiments
"language-store"  // Localization
"musickit"        // Apple Music integration
"storefronts"     // Regional storefronts
"notifStore"      // Notifications
"izStore"         // Unknown
"modals-store"    // Modal dialogs
"theme-store"     // Theming
"plugin-store"    // Plugin management
"provider-store"  // Music providers
"pageStore"       // Page navigation
"search-store"    // Search functionality
"artwork-store"   // Artwork caching
```

### App-State Store

The most important store for accessing app configuration.

```typescript
const appState = cider.store._s.get("app-state");

// Structure:
appState.config = {
  lyrics: {
    timeOffset: number,
    translationEnabled: boolean,
    translationLanguage: string,
    style: { ... },
    // ... more
  },
  audio: {
    volume: number,
    volumeStep: number,
    // ... more
  },
  visual: {
    appearance: 'dark' | 'light',
    // ... more
  },
  // ... many more subsections
};
```

### Direct Store Access vs Config API

```typescript
// ✅ RECOMMENDED: Use config API
cider.config.setValue('lyrics.timeOffset', 2.5);
cider.config.saveConfig();

// ❌ NOT RECOMMENDED: Direct store mutation (won't persist!)
const appState = cider.store._s.get("app-state");
appState.config.lyrics.timeOffset = 2.5;  // Won't save!
```

---

## Real-time Sync

### Watching Store Changes

Use Vue's `watch` to reactively sync with store changes.

```typescript
import { watch } from "vue";

const offset = ref(0);
const appState = cider.store._s.get("app-state");

// Watch for external changes (e.g., from settings panel)
watch(
  () => appState.config.lyrics.timeOffset,
  (newValue) => {
    if (newValue !== offset.value) {
      offset.value = newValue;
      console.log("Synced from external change:", newValue);
    }
  }
);
```

### Complete Bidirectional Sync Example

```typescript
const offset = ref(0);

// Initialize from config
onMounted(() => {
  offset.value = cider.config.getValue('lyrics.timeOffset') || 0;
  
  // Watch for external changes
  const appState = cider.store._s.get("app-state");
  watch(
    () => appState.config.lyrics.timeOffset,
    (newValue) => {
      if (newValue !== offset.value) {
        offset.value = newValue;
      }
    }
  );
});

// Update config when local value changes
const updateOffset = () => {
  cider.config.setValue('lyrics.timeOffset', offset.value);
  cider.config.saveConfig();
};
```

---

## Custom UI Elements

### Defining Custom Elements

```typescript
import { defineCustomElement } from "vue";

export const CustomElements = {
  "lyrics-offset-button": defineCustomElement(LyricsOffsetButton, {
    shadowRoot: false,  // Disable shadow DOM for Cider styling
    configureApp,       // Pass Pinia, etc.
  }),
};
```

### Registering Elements

```typescript
const { customElementName } = definePluginContext({
  ...PluginConfig,
  CustomElements,
  setup() {
    // Register all custom elements
    for (const [key, value] of Object.entries(CustomElements)) {
      customElements.define(customElementName(key), value);
    }
  },
});
```

### Custom Element Naming

The `customElementName` function prefixes your element names:

```typescript
// Your name: "lyrics-offset-button"
// Becomes: "live-lyrics-quick-settings-lyrics-offset-button"
// (prefixed with your plugin's ce_prefix from plugin.config.ts)
```

---

## Menu & Modal Creation

### Creating a Modal

```typescript
import { createModal } from "@ciderapp/pluginkit";

const showModal = () => {
  const { closeDialog, openDialog, dialogElement } = createModal({
    escClose: true,
  });
  
  const content = document.createElement(
    customElementName("my-modal-content")
  );
  
  dialogElement.appendChild(content);
  openDialog();
};
```

---

## Common Configuration Paths

Based on observed structure in `app-state.config`:

```typescript
// Audio
'audio.volume'
'audio.volumeStep'
'audio.exponentialVolume'
'audio.maxVolume'

// Lyrics
'lyrics.timeOffset'
'lyrics.translationEnabled'
'lyrics.translationLanguage'
'lyrics.characterFlow'
'lyrics.lineStaggering'

// Visual
'visual.appearance'  // 'dark' | 'light'
'visual.layoutType'
'visual.useAdaptiveColors'

// General
'general.language'
'general.displayName'
```

---

## TypeScript Tips

### Accessing Internal Properties

Use `@ts-ignore` for accessing undocumented internal APIs:

```typescript
// @ts-ignore - accessing Pinia internal Map
const appState = cider.store._s.get("app-state");

// @ts-ignore - config methods may not be typed
cider.config.setValue('lyrics.timeOffset', 2.5);
```

---

## Debugging Tips

### Inspecting Available Stores

```typescript
console.log("Available stores:", Array.from(cider.store._s.keys()));
```

### Inspecting Config Structure

```typescript
const appState = cider.store._s.get("app-state");
console.log("Config structure:", appState.config);
```

### Listing Available Methods

```typescript
console.log(
  "Config methods:",
  Object.keys(cider.config).filter(k => typeof cider.config[k] === 'function')
);
```

---

## Complete Working Example

See [`LyricsOffsetButton.vue`](./src/components/LyricsOffsetButton.vue) for a complete implementation that:
- Reads config with `getValue`
- Updates config with `setValue`
- Persists with `saveConfig`
- Syncs in real-time with `watch`
- Provides a clean UI with native Cider styling

---

## Summary

**Key Takeaways:**
1. ✅ Use `cider.config.getValue/setValue/saveConfig` for configuration
2. ✅ Access stores via `cider.store._s.get(storeName)`
3. ✅ Use Vue `watch` for real-time sync
4. ✅ Always call `saveConfig()` after `setValue()`
5. ❌ Don't mutate store state directly (won't persist)

**Essential Pattern:**
```typescript
// Read
const value = cider.config.getValue('path.to.setting');

// Write & Save
cider.config.setValue('path.to.setting', newValue);
cider.config.saveConfig();
```
