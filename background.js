const DEFAULT_CONFIG = {
  lazyLoad: true,
  imageOptimization: true,
  noAnimation: true,
  blockAds: true,
  saveData: true,
  preload: true,
};

// Initialize settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ config: DEFAULT_CONFIG });
});

// Early intervention
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId === 0) {
    // Main frame only
    const { config } = await chrome.storage.local.get("config");

    if (config.saveData) {
      chrome.declarativeNetRequest.updateSessionRules({
        addRules: [
          {
            id: 1,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                {
                  header: "Save-Data",
                  operation: "set",
                  value: "on",
                },
              ],
            },
            condition: {
              urlFilter: "*",
              resourceTypes: ["main_frame"],
            },
          },
        ],
      });
    }
  }
});

// Inject early optimizations
chrome.webNavigation.onCommitted.addListener(async (details) => {
  const { config } = await chrome.storage.local.get("config");

  chrome.scripting.executeScript({
    target: { tabId: details.tabId },
    function: injectOptimizations,
    args: [config],
  });
});

function injectOptimizations(config) {
  // Early optimization code
  const style = document.createElement("style");
  style.textContent = `
    ${
      config.noAnimation
        ? "* { animation: none !important; transition: none !important; }"
        : ""
    }
    ${config.lazyLoad ? "img, iframe { loading: lazy !important; }" : ""}
    ${config.imageOptimization ? "img { content-visibility: auto; }" : ""}
  `;
  document.head.appendChild(style);

  // Preload optimization
  if (config.preload) {
    document.querySelectorAll('link[rel="preload"]').forEach((link) => {
      if (!link.href.includes("critical")) {
        link.rel = "prefetch";
      }
    });
  }
}
