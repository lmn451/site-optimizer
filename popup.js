document.addEventListener("DOMContentLoaded", async () => {
  const { config } = await chrome.storage.local.get("config");
  const { enabled = true } = await chrome.storage.local.get("enabled");

  // Create settings UI
  const settingsHTML = Object.entries(config)
    .map(
      ([key, value]) => `
    <div class="setting">
      <div>
        <div class="setting-label">${formatSettingLabel(key)}</div>
        <div class="setting-description">${getSettingDescription(key)}</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="${key}" ${value ? "checked" : ""} ${
        !enabled ? "disabled" : ""
      }>
        <span class="slider"></span>
      </label>
    </div>
  `
    )
    .join("");

  document.getElementById("settings").innerHTML = settingsHTML;

  // Set up master toggle with proper initial state
  const masterToggle = document.getElementById("masterToggle");
  const settingsContainer = document.getElementById("settings");

  masterToggle.checked = enabled;
  settingsContainer.classList.toggle("disabled", !enabled);

  // Handle master toggle changes with error handling
  masterToggle.addEventListener("change", async (e) => {
    try {
      const isEnabled = e.target.checked;
      await chrome.storage.local.set({ enabled: isEnabled });
      settingsContainer.classList.toggle("disabled", !isEnabled);

      // Update all toggles' disabled state
      document
        .querySelectorAll('input[type="checkbox"]:not(#masterToggle)')
        .forEach((input) => {
          input.disabled = !isEnabled;
        });

      // Notify content script
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) {
        chrome.tabs
          .sendMessage(tab.id, {
            type: "EXTENSION_ENABLED_CHANGED",
            enabled: isEnabled,
          })
          .catch(() => {
            // Handle error silently - content script might not be ready
          });
      }
    } catch (error) {
      console.error("Error updating extension state:", error);
      // Revert UI state on error
      e.target.checked = !e.target.checked;
    }
  });

  // Handle individual setting changes with error handling
  document
    .querySelectorAll('input[type="checkbox"]:not(#masterToggle)')
    .forEach((input) => {
      input.addEventListener("change", async (e) => {
        try {
          const { config } = await chrome.storage.local.get("config");
          config[e.target.id] = e.target.checked;
          await chrome.storage.local.set({ config });
        } catch (error) {
          console.error("Error updating setting:", error);
          // Revert UI state on error
          e.target.checked = !e.target.checked;
        }
      });
    });
});

function formatSettingLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getSettingDescription(key) {
  const descriptions = {
    lazyLoad: "Load images only when they become visible",
    imageOptimization: "Optimize image loading and processing",
    noAnimation: "Disable animations for faster loading",
    blockAds: "Block advertisement resources",
    saveData: "Enable data-saving mode",
    preload: "Optimize resource preloading",
  };
  return descriptions[key] || "";
}
