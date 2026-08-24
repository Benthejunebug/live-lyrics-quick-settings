/**
 * DOM selectors used to decide whether a wheel event happened over a lyrics view.
 *
 * Cider 4 ("Genten") renders lyrics as plain Vue components with scoped classes --
 * there are no `cider-*` custom elements in the client, so the selectors below are
 * taken from the class names Cider 4 actually ships. The Cider 3 list is kept as a
 * fallback so the plugin keeps working on older clients.
 */

/** Lyric containers and lines as rendered by Cider 4. */
export const CIDER4_LYRIC_VIEW_SELECTORS = [
  ".lyricView",
  ".lyric-view",
  ".lyric-view-wrapper",
  ".lyric-view-content",
  ".lyric-container",
  ".lyric-content-wrapper",
  ".lyric-line-container",
  ".lyric-line-item",
  ".lyric-line",
  ".lyric-box",
  ".lyric-window",
  ".simple-lyric",
  ".single-line-lyric",
  ".sing-focus-lyrics",
  ".compact-lyrics",
  ".mini-lyrics",
  ".pvim__lyrics",
  ".v-lyrics",
  ".no-lyrics-container",
];

/** Panels that can host a lyrics view. */
export const CIDER4_DRAWER_SELECTORS = [
  ".right-drawer-content",
  ".drawer-content",
  ".immersive-drawer",
];

/** Queue UI -- scrolling here must never adjust the offset. */
export const CIDER4_QUEUE_SELECTORS = [
  ".queue-item",
  ".queue-header",
  ".queue-header-row",
  ".queue-info-bar",
  ".queue-empty-state",
  ".queue-control-platter",
  ".queue-bubble-window",
  ".queue-continuation-footer",
];

/** Chrome/toolbar controls -- also excluded from offset adjustment. */
export const CIDER4_CHROME_BUTTON_SELECTORS = [
  ".chrome-button",
  ".lyrics-button",
  ".lyrics-popup-button",
  ".queue-btn",
  ".queue-bubble-btn",
];

export const CIDER3_LYRIC_VIEW_SELECTORS = [
  ".lyrics-view",
  ".lyrics-line",
  ".lyrics-container",
  ".lyrics-content",
  ".lyrics-body",
  ".lyrics-page",
  "[data-testid='lyrics-view']",
  "[data-test='lyrics-view']",
];

const CIDER_LYRIC_VIEW_SELECTOR = [
  ...CIDER4_LYRIC_VIEW_SELECTORS,
  ...CIDER3_LYRIC_VIEW_SELECTORS,
].join(",");

const CIDER_RIGHT_DRAWER_SELECTOR = CIDER4_DRAWER_SELECTORS.join(",");

const CIDER_NON_LYRIC_CONTROL_SELECTOR = [
  ...CIDER4_QUEUE_SELECTORS,
  ...CIDER4_CHROME_BUTTON_SELECTORS,
].join(",");

const getTargetElement = (target: EventTarget | null) => {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
};

export const isCiderLyricsTarget = (target: EventTarget | null) => {
  const element = getTargetElement(target);
  if (!element) return false;

  if (CIDER_NON_LYRIC_CONTROL_SELECTOR && element.closest(CIDER_NON_LYRIC_CONTROL_SELECTOR)) {
    return false;
  }

  if (element.closest(CIDER_LYRIC_VIEW_SELECTOR)) {
    return true;
  }

  const drawer = element.closest(CIDER_RIGHT_DRAWER_SELECTOR);
  return !!drawer?.querySelector(CIDER_LYRIC_VIEW_SELECTOR);
};
