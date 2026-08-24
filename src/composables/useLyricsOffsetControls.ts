import { computed, ref, watch } from "vue";
import { useCider } from "@ciderapp/pluginkit";
import { runAutoSync } from "../utils/autoSync";
import { clampNumber, formatSeconds } from "../utils/settingsShortcuts";

type PluginConfigShape = {
  audio: {
    useCompanionMic: boolean;
    companionUrl: string;
    companionConnectTimeoutMs: number;
  };
};

const offset = ref(0);
const autoSyncState = ref<"idle" | "listening" | "processing">("idle");
const autoSyncMessage = ref("");
const autoSyncIsError = ref(false);
const undoOffset = ref<number | null>(null);
const debugInfo = ref<unknown>(null);

let hasLoadedInitialOffset = false;
let hasRegisteredOffsetWatch = false;
let saveTimer: number | null = null;
let undoTimer: number | null = null;

const clampOffset = (value: number) => clampNumber(value, -5, 15, 0.1);

const getAppState = (cider: ReturnType<typeof useCider>) => {
  return cider.store?._s?.get("app-state");
};

const saveOffsetNow = (cider: ReturnType<typeof useCider>) => {
  if (typeof cider.config?.setValue !== "function") return;
  cider.config.setValue("lyrics.timeOffset", offset.value);
  if (typeof cider.config?.saveConfig === "function") {
    cider.config.saveConfig();
  }
};

const saveOffsetDebounced = (cider: ReturnType<typeof useCider>) => {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveOffsetNow(cider);
    saveTimer = null;
  }, 150) as unknown as number;
};

const clearUndo = () => {
  if (undoTimer !== null) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  undoOffset.value = null;
};

export const useLyricsOffsetControls = (pluginConfig: PluginConfigShape) => {
  const cider = useCider();

  if (!hasLoadedInitialOffset) {
    hasLoadedInitialOffset = true;
    if (typeof cider.config?.getValue === "function") {
      const initialValue = cider.config.getValue("lyrics.timeOffset");
      offset.value = clampOffset(Number(initialValue || 0));
    }
  }

  if (!hasRegisteredOffsetWatch) {
    const appState = getAppState(cider);
    if (appState?.config?.lyrics) {
      hasRegisteredOffsetWatch = true;
      watch(
        () => appState.config.lyrics.timeOffset,
        (newValue) => {
          const next = clampOffset(Number(newValue || 0));
          if (next !== offset.value) {
            offset.value = next;
          }
        }
      );
    }
  }

  const applyOffset = (value: number, opts: { debounced?: boolean } = {}) => {
    offset.value = clampOffset(value);
    if (opts.debounced) {
      saveOffsetDebounced(cider);
      return;
    }
    saveOffsetNow(cider);
  };

  const adjustOffset = (delta: number, opts: { debounced?: boolean } = {}) => {
    applyOffset(offset.value + delta, opts);
  };

  const resetOffset = () => {
    applyOffset(0);
  };

  const handleUndo = () => {
    if (undoOffset.value === null) return;
    applyOffset(undoOffset.value);
    clearUndo();
  };

  const runAutoOffsetSync = async (event?: MouseEvent) => {
    if (autoSyncState.value !== "idle") return;

    autoSyncMessage.value = "";
    autoSyncIsError.value = false;
    debugInfo.value = null;
    clearUndo();

    const previousOffset = offset.value;
    autoSyncState.value = "listening";

    try {
      const result = await runAutoSync({
        onPhase: (phase) => {
          autoSyncState.value = phase;
        },
        useCompanionMic: pluginConfig.audio.useCompanionMic,
        companionUrl: pluginConfig.audio.companionUrl,
        companionConnectTimeoutMs: pluginConfig.audio.companionConnectTimeoutMs,
      });

      applyOffset(result.offsetSeconds);
      const confidence = Math.round(result.correlation * 100);
      autoSyncMessage.value = `Synced: ${formatSeconds(result.offsetSeconds)} (${confidence}%)`;

      if (event?.shiftKey) {
        debugInfo.value = result.debug;
      }

      undoOffset.value = previousOffset;
      undoTimer = setTimeout(() => {
        undoOffset.value = null;
        undoTimer = null;
      }, 10000) as unknown as number;
    } catch (error: unknown) {
      const err = error as Error & { debug?: unknown };
      autoSyncIsError.value = true;
      autoSyncMessage.value = err.message || "Auto Sync failed.";
      if (err.debug) {
        debugInfo.value = err.debug;
      }
    } finally {
      autoSyncState.value = "idle";
    }
  };

  const copyDebug = () => {
    if (!debugInfo.value) return;
    navigator.clipboard.writeText(JSON.stringify(debugInfo.value, null, 2));
  };

  const autoSyncLabel = computed(() => {
    if (autoSyncState.value === "listening") return "Listening...";
    if (autoSyncState.value === "processing") return "Processing...";
    return "Auto Sync";
  });

  return {
    offset,
    formattedOffset: computed(() => formatSeconds(offset.value)),
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
  };
};
