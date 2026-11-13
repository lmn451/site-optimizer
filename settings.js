// Shared classic-script API for the popup, content scripts and background worker.
(() => {
  const DEFAULT_CONFIG = Object.freeze({
    lazyLoad: true,
    imageOptimization: true,
    noAnimation: true,
    blockAds: true,
    saveData: true,
    preload: true,
  });

  // Small shared ad-domain list, also used to suppress resource hints.
  const AD_DOMAINS = Object.freeze(["doubleclick.net", "googlesyndication.com", "googleadservices.com"]);

  // Only actual booleans are accepted. Missing or malformed values use defaults.
  function normalizeSettings(state = {}) {
    const source = state && typeof state === "object" ? state : {};
    const config = {};
    for (const [key, fallback] of Object.entries(DEFAULT_CONFIG)) {
      config[key] = typeof source.config?.[key] === "boolean"
        ? source.config[key] : fallback;
    }
    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : true,
      config,
    };
  }

  globalThis.OptimizerSettings = Object.freeze({ DEFAULT_CONFIG, AD_DOMAINS, normalizeSettings });
})();
