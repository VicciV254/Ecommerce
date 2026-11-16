/**
 * Changes local storage as another tab of this browser would: each change is written, then announced to this window
 * with the `storage` event a browser fires in every other tab. `null` removes the key.
 */
export function fromAnotherTab(changes: Record<string, string | null>) {
  for (const [key, newValue] of Object.entries(changes)) {
    const oldValue = localStorage.getItem(key);
    if (newValue === null) localStorage.removeItem(key);
    else localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
  }
}
