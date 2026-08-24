export type ShortcutKind = "number" | "boolean" | "select" | "text" | "action";

export type ShortcutGroup = "lyrics" | "scroll" | "companion" | "advanced";

export type ShortcutSource =
  | { type: "cider"; path: string }
  | { type: "plugin"; path: string }
  | { type: "action"; id: string };

export type ShortcutOption<T extends string = string> = {
  label: string;
  value: T;
};

export type SettingsShortcut = {
  id: string;
  group: ShortcutGroup;
  label: string;
  kind: ShortcutKind;
  source: ShortcutSource;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: ShortcutOption[];
  readOnly?: boolean;
  formatter?: (value: unknown) => string;
};

export const MODIFIER_OPTIONS: ShortcutOption<"Alt" | "Control" | "Meta" | "Shift">[] = [
  { label: "Alt", value: "Alt" },
  { label: "Control", value: "Control" },
  { label: "Meta", value: "Meta" },
  { label: "Shift", value: "Shift" },
];

export const SETTINGS_SHORTCUTS: SettingsShortcut[] = [
  {
    id: "lyrics.offset",
    group: "lyrics",
    label: "Lyrics Offset",
    kind: "number",
    source: { type: "cider", path: "lyrics.timeOffset" },
    defaultValue: 0,
    min: -5,
    max: 15,
    step: 0.1,
    formatter: (value) => formatSeconds(Number(value || 0)),
  },
  {
    id: "lyrics.autoSync",
    group: "lyrics",
    label: "Auto Sync",
    kind: "action",
    source: { type: "action", id: "autoSync" },
  },
  {
    id: "scroll.enabled",
    group: "scroll",
    label: "Scroll to Adjust",
    kind: "boolean",
    source: { type: "plugin", path: "scrollToAdjust.enabled" },
    defaultValue: true,
  },
  {
    id: "scroll.modifierKey",
    group: "scroll",
    label: "Modifier Key",
    kind: "select",
    source: { type: "plugin", path: "scrollToAdjust.modifierKey" },
    defaultValue: "Alt",
    options: MODIFIER_OPTIONS,
  },
  {
    id: "scroll.sensitivity",
    group: "scroll",
    label: "Sensitivity",
    kind: "number",
    source: { type: "plugin", path: "scrollToAdjust.scrollSensitivity" },
    defaultValue: 0.1,
    min: 0.05,
    max: 0.5,
    step: 0.05,
    formatter: (value) => Number(value || 0).toFixed(2),
  },
  {
    id: "companion.enabled",
    group: "companion",
    label: "Use Companion Mic",
    kind: "boolean",
    source: { type: "plugin", path: "audio.useCompanionMic" },
    defaultValue: true,
  },
  {
    id: "companion.url",
    group: "companion",
    label: "Companion URL",
    kind: "text",
    source: { type: "plugin", path: "audio.companionUrl" },
    defaultValue: "ws://127.0.0.1:17890",
  },
  {
    id: "companion.timeout",
    group: "companion",
    label: "Connection Timeout",
    kind: "number",
    source: { type: "plugin", path: "audio.companionConnectTimeoutMs" },
    defaultValue: 1000,
    min: 250,
    max: 5000,
    step: 250,
    formatter: (value) => `${Math.round(Number(value || 0))}ms`,
  },
  {
    id: "button.location",
    group: "advanced",
    label: "Button Placement",
    kind: "text",
    source: { type: "plugin", path: "general.buttonLocation" },
    defaultValue: "chrome-top/right",
    readOnly: true,
  },
];

export const getShortcutById = (id: string) => {
  return SETTINGS_SHORTCUTS.find((shortcut) => shortcut.id === id);
};

export const formatSeconds = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}s`;
};

export const clampNumber = (value: number, min: number, max: number, step = 1) => {
  const clamped = Math.max(min, Math.min(max, value));
  const decimals = `${step}`.includes(".") ? `${step}`.split(".")[1].length : 0;
  return Number((Math.round(clamped / step) * step).toFixed(decimals));
};

export const getPathValue = (source: unknown, path: string) => {
  const parts = path.split(".");
  let current = source as Record<string, unknown> | undefined;

  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part] as Record<string, unknown> | undefined;
  }

  return current;
};

export const setPathValue = (source: unknown, path: string, value: unknown) => {
  const parts = path.split(".");
  let current = source as Record<string, unknown>;

  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
};

export const isSensitiveConfigPath = (path: string) => {
  return /token|secret|password|authorization|cookie/i.test(path);
};

export const stringifyConfigValue = (path: string, value: unknown) => {
  if (isSensitiveConfigPath(path)) return "[redacted]";
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
