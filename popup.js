document.addEventListener("DOMContentLoaded", async () => {
  const api = globalThis.browser || globalThis.chrome;
  const { DEFAULT_CONFIG, normalizeSettings } = globalThis.OptimizerSettings;
  const masterToggle = document.getElementById("masterToggle");
  const settingsContainer = document.getElementById("settings");
  const status = document.getElementById("status");
  let queue = Promise.resolve();
  let pending = 0;
  let storageRevision = 0;
  let initialized = false;
  let state = normalizeSettings();
  settingsContainer.innerHTML = Object.keys(DEFAULT_CONFIG).map((key) => `
    <div class="setting">
      <div><div class="setting-label">${formatSettingLabel(key)}</div>
      <div class="setting-description">${getSettingDescription(key)}</div></div>
      <label class="switch"><input type="checkbox" id="${key}" aria-label="${formatSettingLabel(key)}">
      <span class="slider"></span></label>
    </div>`).join("");

  function render() {
    masterToggle.checked = state.enabled;
    settingsContainer.classList.toggle("disabled", !state.enabled);
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      const input = document.getElementById(key);
      input.checked = state.config[key];
      input.disabled = !state.enabled;
    }
  }
  async function readSettings() {
    // An event received during a pending read invalidates its snapshot.
    let before;
    let snapshot;
    do {
      before = storageRevision;
      snapshot = await api.storage.local.get(["enabled", "config"]);
    } while (before !== storageRevision);
    return normalizeSettings(snapshot);
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || (!changes.enabled && !changes.config)) return;
    storageRevision++;
    if (!initialized || pending) return;
    if (changes.enabled) state.enabled = normalizeSettings({ enabled: changes.enabled.newValue }).enabled;
    if (changes.config) state.config = normalizeSettings({ config: changes.config.newValue }).config;
    render();
  });
  masterToggle.disabled = true;
  try {
    state = await readSettings();
    initialized = true;
    masterToggle.disabled = false;
  } catch (error) {
    status.textContent = "Could not load settings. Close and reopen to retry.";
    render();
    for (const key of Object.keys(DEFAULT_CONFIG)) document.getElementById(key).disabled = true;
    return;
  }
  render();

  // Serialize read/merge/write operations so rapid changes in this popup cannot
  // overwrite each other. Read fresh state for every operation, not the UI cache.
  function update(key, value) {
    pending++;
    queue = queue.then(async () => {
      try {
        const fresh = normalizeSettings(await api.storage.local.get(["enabled", "config"]));
        const patch = key === "enabled" ? { enabled: value }
          : { config: { ...fresh.config, [key]: value } };
        await api.storage.local.set(patch);
        state = await readSettings();
        status.textContent = "";
      } catch (error) {
        status.textContent = "Could not save settings. Please try again.";
        try {
          state = await readSettings();
        } catch (_) { /* Keep the last confirmed state if storage is unavailable. */ }
      } finally {
        pending--;
        if (!pending) render();
      }
    });
  }
  masterToggle.addEventListener("change", (event) => {
    // Apply disabled styling immediately, while persistence stays serialized.
    const enabled = event.target.checked;
    settingsContainer.classList.toggle("disabled", !enabled);
    for (const key of Object.keys(DEFAULT_CONFIG)) document.getElementById(key).disabled = !enabled;
    update("enabled", enabled);
  });
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    document.getElementById(key).addEventListener("change", (event) => update(key, event.target.checked));
  }
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
