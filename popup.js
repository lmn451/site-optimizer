document.addEventListener("DOMContentLoaded", async () => {
  const { config } = await chrome.storage.local.get("config");

  const settings = Object.entries(config)
    .map(
      ([key, value]) => `
    <div class="setting">
      <label class="switch">
        <input type="checkbox" id="${key}" ${value ? "checked" : ""}>
        <span class="slider"></span>
      </label>
      <span>${key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
    </div>
  `
    )
    .join("");

  document.getElementById("settings").innerHTML = settings;

  document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", async (e) => {
      const { config } = await chrome.storage.local.get("config");
      config[e.target.id] = e.target.checked;
      await chrome.storage.local.set({ config });
    });
  });
});
