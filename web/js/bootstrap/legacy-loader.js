export function loadLegacyScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, import.meta.url).toString();
    script.async = false;
    script.onload = () => resolve(path);
    script.onerror = () => reject(new Error(`Failed to load renderer script: ${path}`));
    document.body.appendChild(script);
  });
}

export async function loadLegacyScriptsSequentially(paths = []) {
  for (const path of paths) {
    // Sequential classic-script loading preserves the existing global execution contract.
    await loadLegacyScript(path);
  }
}
