import { defineCustomElement } from "vue";
import type { App } from "vue";
import { createPinia } from "pinia";
import {
  definePluginContext,

  addCustomButton,
  useCiderAudio,
} from "@ciderapp/pluginkit";
import PluginConfig from "./plugin.config";

import LyricsOffsetButton from "./components/LyricsOffsetButton.vue";

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
        customElements.define(customElementName(_key), value);
      }



      // Here we add a custom button to the top right of the chrome
      addCustomButton({
        element: "⏱️",
        location: "chrome-top/right",
        title: "Lyrics Offset",
        menuElement: customElementName("lyrics-offset-button"),
      });

      const audio = useCiderAudio();
      audio.subscribe("ready", () => {
        console.log("CiderAudio is ready!", audio.context);
      });


    },
  });

/**
 * Some boilerplate code for our own configuration
 */
export const cfg = setupConfig({

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
