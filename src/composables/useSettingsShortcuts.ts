import { computed, ref } from "vue";
import { useCider } from "@ciderapp/pluginkit";
import type { SettingsShortcut } from "../utils/settingsShortcuts";
import {
  clampNumber,
  getPathValue,
  setPathValue,
  stringifyConfigValue,
} from "../utils/settingsShortcuts";

type ShortcutConfig = Record<string, unknown>;

export type ConfigExplorerEntry = {
  path: string;
  value: unknown;
  text: string;
  depth: number;
};

const normalizeShortcutValue = (shortcut: SettingsShortcut, value: unknown) => {
  if (shortcut.kind !== "number") return value;
  const numeric = Number(value);
  const fallback = Number(shortcut.defaultValue || 0);
  const safeValue = Number.isFinite(numeric) ? numeric : fallback;
  if (typeof shortcut.min === "number" && typeof shortcut.max === "number") {
    return clampNumber(safeValue, shortcut.min, shortcut.max, shortcut.step || 1);
  }
  return safeValue;
};

const flattenConfigEntries = (
  source: unknown,
  pathPrefix = "",
  entries: ConfigExplorerEntry[] = []
) => {
  if (!source || typeof source !== "object") return entries;
  const objectValue = source as Record<string, unknown>;

  for (const key of Object.keys(objectValue).sort((a, b) => a.localeCompare(b))) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    const value = objectValue[key];

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenConfigEntries(value, path, entries);
      continue;
    }

    entries.push({
      path,
      value,
      text: stringifyConfigValue(path, value),
      depth: Math.max(0, path.split(".").length - 1),
    });
  }

  return entries;
};

export const useSettingsShortcuts = (pluginConfig: ShortcutConfig) => {
  const cider = useCider();
  const saveState = ref<"idle" | "saved">("idle");
  const explorerSearch = ref("");
  const companionTestState = ref<"idle" | "testing" | "success" | "error">("idle");
  const companionTestMessage = ref("");

  let saveStatusTimer: number | null = null;

  const markSaved = () => {
    saveState.value = "saved";
    if (saveStatusTimer !== null) {
      clearTimeout(saveStatusTimer);
    }
    saveStatusTimer = setTimeout(() => {
      saveState.value = "idle";
      saveStatusTimer = null;
    }, 1200) as unknown as number;
  };

  const saveConfig = () => {
    if (typeof cider.config?.saveConfig === "function") {
      cider.config.saveConfig();
    }
    markSaved();
  };

  const getShortcutValue = (shortcut: SettingsShortcut) => {
    if (shortcut.source.type === "plugin") {
      return getPathValue(pluginConfig, shortcut.source.path) ?? shortcut.defaultValue;
    }
    if (shortcut.source.type === "cider" && typeof cider.config?.getValue === "function") {
      return cider.config.getValue(shortcut.source.path) ?? shortcut.defaultValue;
    }
    return shortcut.defaultValue;
  };

  const setShortcutValue = (shortcut: SettingsShortcut, value: unknown) => {
    if (shortcut.readOnly) return;
    const nextValue = normalizeShortcutValue(shortcut, value);

    if (shortcut.source.type === "plugin") {
      setPathValue(pluginConfig, shortcut.source.path, nextValue);
      saveConfig();
      return;
    }

    if (shortcut.source.type === "cider" && typeof cider.config?.setValue === "function") {
      cider.config.setValue(shortcut.source.path, nextValue);
      saveConfig();
    }
  };

  const getFormattedShortcutValue = (shortcut: SettingsShortcut) => {
    const value = getShortcutValue(shortcut);
    return shortcut.formatter ? shortcut.formatter(value) : String(value ?? "");
  };

  const configEntries = computed(() => {
    const source =
      typeof cider.config?.getRef === "function"
        ? cider.config.getRef()
        : {};
    const query = explorerSearch.value.trim().toLowerCase();
    const entries = flattenConfigEntries(source);

    if (!query) return entries;
    return entries.filter((entry) => {
      return (
        entry.path.toLowerCase().includes(query) ||
        entry.text.toLowerCase().includes(query)
      );
    });
  });

  const groupedConfigEntries = computed(() => {
    const groups = new Map<string, ConfigExplorerEntry[]>();

    for (const entry of configEntries.value) {
      const section = entry.path.split(".")[0] || "config";
      if (!groups.has(section)) {
        groups.set(section, []);
      }
      groups.get(section)?.push(entry);
    }

    return [...groups.entries()].map(([section, entries]) => ({
      section,
      entries,
    }));
  });

  const copyExplorerEntry = (entry: ConfigExplorerEntry) => {
    navigator.clipboard.writeText(`${entry.path}: ${entry.text}`);
  };

  const testCompanionConnection = async (url: string, timeoutMs: number) => {
    companionTestState.value = "testing";
    companionTestMessage.value = "Checking companion...";

    try {
      const message = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            ws.close();
          } catch {
            // no-op
          }
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const cleanup = () => {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            // no-op
          }
        };

        ws.onerror = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("Connection failed"));
        };

        ws.onopen = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve("Companion reachable");
        };

        ws.onmessage = (event) => {
          if (settled) return;
          if (typeof event.data !== "string") return;
          settled = true;
          cleanup();
          resolve(`Companion responded: ${event.data}`);
        };
      });

      companionTestState.value = "success";
      companionTestMessage.value = message;
    } catch (error: unknown) {
      const err = error as Error;
      companionTestState.value = "error";
      companionTestMessage.value = err.message || "Companion check failed";
    }
  };

  return {
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
  };
};
