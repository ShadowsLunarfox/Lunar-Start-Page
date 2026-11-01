// Shared local fonts for both interfaces. Font bytes stay out of localStorage.
(() => {
  const MAX_BYTES = 20 * 1024 * 1024;
  const DEFAULT = { type: "system", family: "", id: "", name: "" };
  const FALLBACK = '"Segoe UI Variable", "Segoe UI", "Noto Sans SC", system-ui, sans-serif';
  let activeFace = null, revision = 0, signature = "", applying = Promise.resolve();
  let initialized = false, busy = false, notice = "", unavailable = false;
  const prepared = new Map();
  const cleanName = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) : "";

  function sanitize(value) {
    if (value?.type === "file" && typeof value.id === "string" && /^[a-f0-9-]{36}$/.test(value.id)) {
      return { type: "file", family: "", id: value.id, name: cleanName(value.name) || "Custom font" };
    }
    return { ...DEFAULT, family: cleanName(value?.family) };
  }

  function useFamily(family) {
    const root = document.documentElement;
    root.toggleAttribute("data-custom-font", Boolean(family));
    if (family) root.style.setProperty("--custom-font-family", `${JSON.stringify(family)}, ${FALLBACK}`);
    else root.style.removeProperty("--custom-font-family");
  }

  function store(mode, action) {
    return new Promise((resolve, reject) => {
      const opening = indexedDB.open("lunarStartSharedFonts", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("fonts");
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction("fonts", mode);
        let result;
        const request = action(transaction.objectStore("fonts"));
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => { database.close(); resolve(result); };
        transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Font storage failed")); };
      };
    });
  }

  function apply(value) {
    const font = sanitize(value), next = JSON.stringify(font);
    if (signature === next) return applying;
    signature = next;
    const current = ++revision;
    if (activeFace) document.fonts.delete(activeFace);
    activeFace = null;
    unavailable = false;
    useFamily(font.type === "system" ? font.family : "");
    applying = (async () => {
      if (font.type !== "file") return;
      try {
        let face = prepared.get(font.id);
        prepared.delete(font.id);
        if (!face) {
          const record = await store("readonly", fonts => fonts.get(font.id));
          if (!record?.blob || record.blob.size > MAX_BYTES) throw new Error("Font is unavailable");
          face = await new FontFace(`LunarFont-${font.id}`, await record.blob.arrayBuffer(), { display: "swap" }).load();
        }
        if (current !== revision) return;
        document.fonts.add(face);
        activeFace = face;
        useFamily(face.family);
        if (typeof schedulePanelNormalization === "function" && typeof draggablePanelEls !== "undefined") schedulePanelNormalization(true);
      } catch {
        if (current === revision) unavailable = true;
      }
    })().finally(() => { if (current === revision) localize(); });
    return applying;
  }

  function label(key, values = {}) { return typeof t === "function" ? t(`fonts.${key}`, values) : ""; }
  function localize() {
    if (!initialized) return;
    const font = sanitize(state.settings.font), input = document.getElementById("custom-font-family");
    if (document.activeElement !== input) input.value = font.type === "system" ? font.family : "";
    const status = document.getElementById("custom-font-status");
    status.textContent = label(notice || (unavailable ? "unavailable" : font.type === "file" ? "file_active" : font.family ? "system_active" : "default_active"), { name: font.type === "file" ? font.name : font.family });
    document.querySelectorAll("[data-font-action]").forEach(button => { button.disabled = busy; });
    input.disabled = busy;
  }

  async function forgetPrevious(previous) {
    if (previous?.type !== "file" || previous.id === state.settings.font.id) return;
    // Another tab may still be publishing this selection; never remove its asset.
    try {
      const shared = JSON.parse(localStorage.getItem("lunarShared:v1:field:settings.font") || "null");
      if (shared?.id !== previous.id) await store("readwrite", fonts => fonts.delete(previous.id));
    } catch { /* An unused local cache can be removed when extension data is cleared. */ }
  }

  async function commit(font) {
    if (typeof flushPendingSettingChanges === "function") flushPendingSettingChanges();
    const previous = state.settings.font;
    state.settings = sanitizeSettings({ ...state.settings, font });
    if (!saveState(true)) {
      state.settings = sanitizeSettings({ ...state.settings, font: previous });
      void apply(previous);
      return false;
    }
    renderAfterSettingChange("font");
    await apply(state.settings.font);
    await forgetPrevious(previous);
    return true;
  }

  async function prepare(blob, name) {
    if (!blob.size || blob.size > MAX_BYTES) throw new Error("size");
    const bytes = await blob.arrayBuffer(), header = new DataView(bytes);
    if (bytes.byteLength < 12 || ![0x00010000, 0x4f54544f, 0x774f4646, 0x774f4632].includes(header.getUint32(0))) throw new Error("invalid");
    const id = crypto.randomUUID();
    let face;
    try { face = await new FontFace(`LunarFont-${id}`, bytes, { display: "swap" }).load(); }
    catch { throw new Error("invalid"); }
    try { await store("readwrite", fonts => fonts.put({ blob, name: cleanName(name) }, id)); }
    catch { throw new Error("save"); }
    prepared.clear();
    prepared.set(id, face);
    return { type: "file", family: "", id, name: cleanName(name) || "Custom font" };
  }

  async function upload(file) {
    if (!file || busy) return;
    busy = true; notice = "loading"; localize();
    let candidate;
    try {
      if (!/\.(ttf|otf|woff|woff2)$/i.test(file.name)) throw new Error("invalid");
      candidate = await prepare(file, file.name);
      notice = "";
      if (!await commit(candidate)) throw new Error("save");
    } catch (error) {
      notice = error.message === "size" ? "too_large" : error.message === "save" ? "save_failed" : "invalid";
      if (candidate) { prepared.delete(candidate.id); await forgetPrevious(candidate); }
    } finally {
      busy = false;
      document.getElementById("custom-font-file").value = "";
      localize();
    }
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    document.getElementById("custom-font-apply").addEventListener("click", async () => {
      if (busy) return;
      notice = "";
      await commit({ type: "system", family: document.getElementById("custom-font-family").value });
      localize();
    });
    document.getElementById("custom-font-reset").addEventListener("click", async () => {
      if (busy) return;
      notice = "";
      await commit(DEFAULT);
      localize();
    });
    document.getElementById("custom-font-import").addEventListener("click", () => {
      const input = document.getElementById("custom-font-file");
      input.value = "";
      input.click();
    });
    document.getElementById("custom-font-file").addEventListener("change", event => { void upload(event.target.files?.[0]); });
    document.getElementById("custom-font-family").addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); document.getElementById("custom-font-apply").click(); }
    });
    void apply(state.settings.font);
    localize();
  }

  async function exportAsset(value) {
    const font = sanitize(value);
    if (font.type !== "file") return null;
    const record = await store("readonly", fonts => fonts.get(font.id));
    if (!record?.blob) throw new Error("The selected font file is unavailable");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(record.blob);
    });
    return { name: font.name, data };
  }

  async function restoreAsset(value, asset) {
    const font = sanitize(value);
    if (font.type !== "file") return font;
    if (!asset) {
      const record = await store("readonly", fonts => fonts.get(font.id));
      if (!record?.blob) throw new Error("The backup has no font file");
      return font;
    }
    if (typeof asset.data !== "string" || asset.data.length > Math.ceil(MAX_BYTES / 3) * 4 + 100) throw new Error("Invalid font backup");
    const match = /^data:(?:font\/[a-z0-9.+-]+|application\/(?:octet-stream|x-font-[a-z0-9-]+|vnd\.ms-opentype));base64,([a-z0-9+/=]+)$/i.exec(asset.data);
    if (!match) throw new Error("Invalid font backup");
    const binary = atob(match[1]), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return prepare(new Blob([bytes], { type: "application/octet-stream" }), font.name);
  }

  globalThis.lunarFonts = { sanitize, apply, initialize, localize, exportAsset, restoreAsset, forgetPrevious };

  // Start restoring the saved face before the application and settings dialog load.
  if (typeof document !== "undefined" && !globalThis.__lunarBlockMainPage) {
    try {
      const shared = JSON.parse(localStorage.getItem("lunarShared:v1:field:settings.font") || "null");
      const key = document.documentElement.dataset.interfaceVersion === "legacy" ? "customHomeStateLegacy" : "customHomeState";
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      void apply(shared || saved?.settings?.font);
    } catch { /* Keep the interface's default font if local storage is unavailable. */ }
  }
})();
