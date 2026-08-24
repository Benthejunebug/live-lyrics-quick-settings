export const SETTINGS_SHORTCUTS_OPEN_EVENT = "live-lyrics-quick-settings:open-control-center";

export const requestSettingsShortcutsControlCenter = () => {
  window.dispatchEvent(new CustomEvent(SETTINGS_SHORTCUTS_OPEN_EVENT));
};
