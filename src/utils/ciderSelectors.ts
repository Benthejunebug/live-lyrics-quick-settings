export const CIDER4_LYRIC_VIEW_SELECTORS = [
  "cider-lyric-view",
  "cider-lyric-line",
  "cider-simple-lyric-view",
  "cider-immersive-lyric-view",
];

export const CIDER4_DRAWER_SELECTORS = [
  "cider-right-drawer-content",
];

export const CIDER4_QUEUE_SELECTORS = [
  "cider-amqueue",
];

export const CIDER4_CHROME_BUTTON_SELECTORS = [
  "cider-lyrics-button",
  "cider-queue-button",
];

export const CIDER3_LYRIC_VIEW_SELECTORS = [
  ".lyric-view",
  ".lyrics-view",
  ".lyric-line",
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
