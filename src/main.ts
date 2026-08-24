import { defineCustomElement } from "vue";
import type { App } from "vue";
import { createPinia } from "pinia";
import {
  definePluginContext,
  addMainMenuEntry,
  addCustomButton,
  createModal,
  useCiderAudio,
} from "@ciderapp/pluginkit";
import PluginConfig from "./plugin.config";

import LyricsOffsetButton from "./components/LyricsOffsetButton.vue";
import LyricsScrollHandler from "./components/LyricsScrollHandler.vue";
import SettingsShortcutsControlCenter from "./components/SettingsShortcutsControlCenter.vue";
import { SETTINGS_SHORTCUTS_OPEN_EVENT } from "./utils/controlCenterEvents";

const AUDIO_READY_SUBSCRIPTION_KEY = "__llqs_audio_ready_subscribed__";
const SETTINGS_SHORTCUTS_BUTTON_TRIGGER = "LIVE_LYRICS_OFFSET_TRIGGER";
const SETTINGS_SHORTCUTS_BUTTON_ATTR = "data-settings-shortcuts-button";
const SETTINGS_SHORTCUTS_ICON = `
<svg
  aria-hidden="true"
  viewBox="0 0 24 24"
  width="18"
  height="18"
  style="display:block;overflow:visible"
  xmlns="http://www.w3.org/2000/svg"
>
  <path d="M9 2.6h6v2H9z" fill="#d7dce5" />
  <path d="M5.2 4.4l1.4-1.4 2.2 2.2-1.4 1.4z" fill="#bfc7d4" />
  <path d="M18.8 4.4l-1.4-1.4-2.2 2.2 1.4 1.4z" fill="#bfc7d4" />
  <circle cx="12" cy="13" r="8.1" fill="#eef3fb" stroke="#647083" stroke-width="1.6" />
  <circle cx="12" cy="13" r="6.2" fill="#ffffff" opacity=".72" />
  <path d="M12 13V8.7" stroke="#364154" stroke-width="1.9" stroke-linecap="round" />
  <path d="M12 13l3.2-2.4" stroke="#364154" stroke-width="1.9" stroke-linecap="round" />
  <circle cx="12" cy="13" r="1.2" fill="#364154" />
  <path d="M7.4 18.4a8 8 0 0 0 9.2 0" stroke="#cfd7e4" stroke-width="1.3" stroke-linecap="round" />
</svg>
`;
let buttonHydrationObserver: MutationObserver | null = null;
let activeControlCenterModal: ReturnType<typeof createModal> | null = null;
let controlCenterListenerRegistered = false;
let mainMenuEntryRegistered = false;
let scrollHandlerMounted = false;

const hydrateSettingsShortcutsButton = () => {
  const contents = new Set<HTMLElement>();

  for (const content of document.querySelectorAll(".chrome-button-content")) {
    if (content instanceof HTMLElement && content.textContent?.includes(SETTINGS_SHORTCUTS_BUTTON_TRIGGER)) {
      contents.add(content);
    }
  }

  for (const content of document.querySelectorAll(
    `button[${SETTINGS_SHORTCUTS_BUTTON_ATTR}="true"] .chrome-button-content, button[title="Lyric Offset"] .chrome-button-content, button[title="Lyrics Offset"] .chrome-button-content, button[title="Settings Shortcuts"] .chrome-button-content`
  )) {
    if (content instanceof HTMLElement) {
      contents.add(content);
    }
  }

  for (const content of contents) {
    const alreadyHydrated = content.querySelector(".settings-shortcuts-button");
    if (alreadyHydrated && !content.textContent?.includes(SETTINGS_SHORTCUTS_BUTTON_TRIGGER)) {
      continue;
    }

    const button = content.closest("button");
    if (button instanceof HTMLElement) {
      button.setAttribute(SETTINGS_SHORTCUTS_BUTTON_ATTR, "true");
      button.setAttribute("aria-label", "Lyric Offset");
    }

    content.innerHTML = `
      <span
        class="settings-shortcuts-button"
        aria-hidden="true"
        style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"
      >
        ${SETTINGS_SHORTCUTS_ICON}
      </span>
    `;
  }
};

const observeSettingsShortcutsButton = () => {
  hydrateSettingsShortcutsButton();
  buttonHydrationObserver?.disconnect();
  buttonHydrationObserver = new MutationObserver(() => {
    hydrateSettingsShortcutsButton();
  });
  buttonHydrationObserver.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
  });
};

/**
 * Initializing a Vue app instance so we can use things like Pinia.
 */
const pinia = createPinia();

/**
 * Function that configures the app instances of the custom elements
 */
function configureApp(app: App) {
  app.use(pinia);
}

/**
 * Custom Elements that will be registered in the app
 */
export const CustomElements = {

  "lyrics-offset-button": defineCustomElement(LyricsOffsetButton, {
    shadowRoot: false,
    configureApp,
  }),
  "lyrics-scroll-handler": defineCustomElement(LyricsScrollHandler, {
    shadowRoot: false,
    configureApp,
  }),
  "settings-shortcuts-control-center": defineCustomElement(SettingsShortcutsControlCenter, {
    shadowRoot: false,
    configureApp,
  }),
};

/**
 * Defining the plugin context
 */
const { plugin, setupConfig, customElementName, goToPage, useCPlugin } =
  definePluginContext({
    ...PluginConfig,
    CustomElements,
    setup() {
      /**
       * Registering the custom elements in the app
       */
      for (const [key, value] of Object.entries(CustomElements)) {
        const _key = key as keyof typeof CustomElements;
        const elementName = customElementName(_key);
        if (!customElements.get(elementName)) {
          customElements.define(elementName, value);
        }
      }



      // Safety check: If the user is not on Mojave layout, the button won't show.
      // We'll reset it to top-right if it's set to the player controls to ensure visibility.
      if (cfg.value.general.buttonLocation === "mojave/player/right") {
        cfg.value.general.buttonLocation = "chrome-top/right";
      }

      // Here we add a custom button to the chrome
      addCustomButton({
        element: SETTINGS_SHORTCUTS_BUTTON_TRIGGER,
        location: cfg.value.general.buttonLocation,
        title: "Lyric Offset",
        menuElement: customElementName("lyrics-offset-button"),
      });
      observeSettingsShortcutsButton();
      observeControlCenterRequests();
      safelyRegisterMainMenuEntry();
      safelyMountScrollHandler();

      const audio = useCiderAudio();
      const audioFlags = audio as unknown as Record<string, boolean> | null;
      if (audioFlags && !audioFlags[AUDIO_READY_SUBSCRIPTION_KEY]) {
        audioFlags[AUDIO_READY_SUBSCRIPTION_KEY] = true;
        audio.subscribe("ready", () => {
          console.log("CiderAudio is ready!", audio.context);
        });
      }


    },
  });

const openSettingsShortcutsControlCenter = () => {
  if (activeControlCenterModal?.dialogElement.isConnected) {
    activeControlCenterModal.dialogElement.focus();
    return;
  }

  const element = document.createElement(customElementName("settings-shortcuts-control-center"));
  let modal: ReturnType<typeof createModal> | null = null;

  const closeModal = () => {
    modal?.closeDialog();
  };

  element.addEventListener("close", closeModal);

  modal = createModal({
    escClose: true,
    className: ["settings-shortcuts-modal"],
    element,
  });

  modal.dialogElement.addEventListener(
    "close",
    () => {
      element.removeEventListener("close", closeModal);
      if (activeControlCenterModal === modal) {
        activeControlCenterModal = null;
      }
    },
    { once: true }
  );

  activeControlCenterModal = modal;
  modal.openDialog();
};

const observeControlCenterRequests = () => {
  if (controlCenterListenerRegistered) return;
  controlCenterListenerRegistered = true;
  window.addEventListener(SETTINGS_SHORTCUTS_OPEN_EVENT, openSettingsShortcutsControlCenter);
};

const safelyRegisterMainMenuEntry = () => {
  if (mainMenuEntryRegistered) return;
  mainMenuEntryRegistered = true;

  try {
    addMainMenuEntry({
      label: "Settings Shortcuts",
      onClick: openSettingsShortcutsControlCenter,
    });
  } catch (error) {
    console.warn("[SettingsShortcuts] Unable to register main menu entry:", error);
  }
};

const safelyMountScrollHandler = () => {
  if (scrollHandlerMounted) return;

  try {
    const elementName = customElementName("lyrics-scroll-handler");
    if (document.querySelector(elementName)) {
      scrollHandlerMounted = true;
      return;
    }

    const element = document.createElement(elementName);
    element.setAttribute("aria-hidden", "true");
    document.body.appendChild(element);
    scrollHandlerMounted = true;
  } catch (error) {
    console.warn("[SettingsShortcuts] Unable to mount scroll handler:", error);
  }
};

/**
 * Some boilerplate code for our own configuration
 */
export const cfg = setupConfig({
  general: {
    buttonLocation: <"chrome-top/right" | "mojave/player/right">"chrome-top/right",
  },
  audio: {
    useCompanionMic: <boolean>true,
    companionUrl: <string>"ws://127.0.0.1:17890",
    companionConnectTimeoutMs: <number>1000,
  },
  scrollToAdjust: {
    enabled: <boolean>true,
    modifierKey: <"Alt" | "Control" | "Meta" | "Shift">"Alt",
    scrollSensitivity: <number>0.1,
  },
});

export function useConfig() {
  return cfg.value;
}

/**
 * Exporting the plugin and functions
 */
export { setupConfig, customElementName, goToPage, useCPlugin };

/**
 * Exporting the plugin, Cider will use this to load the plugin
 */
export default plugin;
