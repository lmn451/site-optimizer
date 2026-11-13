// Firefox loads settings.js via background.scripts, Chrome via importScripts.
if (!globalThis.OptimizerSettings && typeof importScripts === "function") {
  importScripts("settings.js");
}

(() => {
  const { normalizeSettings, AD_DOMAINS } = globalThis.OptimizerSettings;
  const api = globalThis.browser || globalThis.chrome;
  const SAVE_DATA_ID = 1;
  const ADS_ID = 2;
  // Deliberately small ad-domain list, not a general-purpose ad blocker.
  // Only third-party subresources are blocked, never top-level navigation.
  const SUBRESOURCES = ["sub_frame", "stylesheet", "script", "image", "font",
    "object", "xmlhttprequest", "ping", "media", "websocket", "other"];
  let queue = Promise.resolve();

  async function reconcile(initialize) {
    // Read inside the queue rather than capturing stale onChanged payloads.
    const stored = await api.storage.local.get(["enabled", "config"]);
    const state = normalizeSettings(stored);
    if (initialize) {
      const patch = {};
      if (stored.enabled !== state.enabled) patch.enabled = state.enabled;
      if (JSON.stringify(stored.config) !== JSON.stringify(state.config)) patch.config = state.config;
      if (Object.keys(patch).length) await api.storage.local.set(patch);
    }
    const addRules = [];
    if (state.enabled && state.config.saveData) {
      addRules.push({
        id: SAVE_DATA_ID,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [
          { header: "Save-Data", operation: "set", value: "on" },
        ] },
        condition: { urlFilter: "*", resourceTypes: ["main_frame", ...SUBRESOURCES] },
      });
    }
    if (state.enabled && state.config.blockAds) {
      addRules.push({
        id: ADS_ID,
        priority: 1,
        action: { type: "block" },
        condition: { requestDomains: AD_DOMAINS, domainType: "thirdParty", resourceTypes: SUBRESOURCES },
      });
    }
    // This extension exclusively owns its session rules. Replace the complete set
    // to migrate the old unbounded, per-navigation Save-Data duplicates as well.
    const existing = await api.declarativeNetRequest.getSessionRules();
    await api.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing.map((rule) => rule.id), addRules,
    });
  }

  function schedule(initialize = false) {
    queue = queue.then(() => reconcile(initialize)).catch((error) => {
      console.error("Could not synchronize optimizer settings:", error);
    });
    return queue;
  }
  api.runtime.onInstalled.addListener(() => schedule(true));
  api.runtime.onStartup.addListener(() => schedule(true));
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.config)) schedule();
  });
  // Also restore session rules on worker startup, without waiting for navigation.
  schedule(true);
})();
