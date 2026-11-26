const defaults = { wide: true, watermark: true, panels: true, autoHideHeader: false };
chrome.storage.local.get(defaults, settings => {
  for (const key of Object.keys(defaults)) document.getElementById(key).checked = Boolean(settings[key]);
});
for (const key of Object.keys(defaults)) {
  document.getElementById(key).addEventListener('change', event => chrome.storage.local.set({ [key]: event.target.checked }));
}
