// Feature-level choices are local to this browser profile. Opening the homepage never asks for agreement.
(() => {
  const prefix = "lunarFeatureConsent:v1:";
  const features = ["suggestions", "resources", "voice", "image"];
  const blocked = new Set();
  const fallback = {
    title: "Data use & optional features",
    local: "Bookmarks, settings, wallpapers and search history stay in this browser profile. Backups leave it only when you export or share them. Choose optional online features below; each can be turned off here.",
    search_note: "Searching sends your query to the selected provider and saves search history on this device.",
    suggestions_title: "Online search suggestions",
    suggestions_body: "While you type, your query is sent to the selected suggestion providers and their fallback providers (including Google or DuckDuckGo). Multi-engine mode sends it to every checked provider. They receive your IP address and normal request information. Turn this off here or in Search suggestions to stop these requests.",
    resources_title: "Online icons, fonts and images",
    resources_body: "Loading online shortcut icons sends saved site domains to Google's favicon service. Custom icon or wallpaper URLs contact their hosts, and the legacy Cartoon font contacts Google Fonts. These services receive your IP address and normal request information. This is off by default; bundled and uploaded local assets still work.",
    voice_title: "Voice search",
    voice_body: "After you start voice search and grant microphone permission, your browser's speech recognition service may process your audio. When recognition finishes, the recognized text is automatically submitted to the selected search provider and saved in local search history. This extension does not keep audio recordings. Stop recording with the microphone button or revoke microphone access in the browser.",
    image_title: "Image search",
    image_body: "Choosing or dropping an image for image search uploads that file to Google Lens to find matching images. Google receives the image and normal request information. Canceling this notice sends nothing. This extension does not keep the uploaded image.",
    enable: "Agree and enable", disable: "Turn off", cancel: "Cancel", storage_error: "This choice could not be saved. Allow local storage or free up space, then try again."
  };
  let active = null;
  let initialized = false;
  const label = key => {
    const value = typeof t === "function" ? t(`feature_privacy.${key}`) : "";
    return value && value !== `feature_privacy.${key}` ? value : fallback[key] || key;
  };
  function has(feature) {
    if (!features.includes(feature) || blocked.has(feature)) return false;
    try {
      const record = JSON.parse(localStorage.getItem(prefix + feature));
      return record?.version === 1 && Number.isFinite(Date.parse(record.acceptedAt));
    } catch { return false; }
  }
  function allowsUrl(value) {
    if (!value) return true;
    try {
      const url = new URL(value, document.baseURI);
      return url.origin === location.origin || /^(data:|blob:)$/.test(url.protocol) || has("resources");
    } catch { return false; }
  }
  function notify(feature) {
    window.dispatchEvent(new CustomEvent("lunarprivacychange", {detail:{feature, allowed:has(feature)}}));
    localize();
  }
  function revoke(feature) {
    blocked.add(feature);
    try { localStorage.removeItem(prefix + feature); } catch { /* The current page still stops using the feature. */ }
    notify(feature);
  }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function request(feature) {
    if (!features.includes(feature)) return Promise.resolve(false);
    if (has(feature)) return Promise.resolve(true);
    if (active) return active.feature === feature ? active.promise : Promise.resolve(false);
    const dialog = node("dialog", "", "feature-privacy-dialog");
    dialog.id = "feature-privacy-dialog";
    dialog.setAttribute("aria-labelledby", "feature-privacy-heading");
    dialog.setAttribute("aria-describedby", "feature-privacy-details");
    const heading = node("h2", label(feature + "_title"));
    heading.id = "feature-privacy-heading";
    const details = node("p", label(feature + "_body"));
    details.id = "feature-privacy-details";
    const error = node("p"); error.hidden = true; error.setAttribute("role", "alert");
    const actions = node("div", "", "feature-privacy-actions");
    const cancel = node("button", label("cancel")); cancel.type = "button"; cancel.dataset.privacyAction = "cancel";
    const agree = node("button", label("enable")); agree.type = "button"; agree.dataset.privacyAction = "agree";
    actions.append(cancel, agree);
    dialog.append(heading, details, error, actions);
    document.body.append(dialog);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    active = {feature, promise};
    let accepted = false;
    cancel.addEventListener("click", () => dialog.close());
    agree.addEventListener("click", () => {
      try {
        const value = JSON.stringify({version:1, acceptedAt:new Date().toISOString()});
        localStorage.setItem(prefix + feature, value);
        if (localStorage.getItem(prefix + feature) !== value) throw new Error("Choice not saved");
        blocked.delete(feature);
        accepted = true;
        dialog.close();
      } catch { error.textContent = label("storage_error"); error.hidden = false; }
    });
    dialog.addEventListener("close", () => {
      dialog.remove(); active = null;
      if (accepted) notify(feature);
      resolve(accepted);
    }, {once:true});
    dialog.showModal();
    return promise;
  }
  function localize() {
    document.querySelectorAll("[data-privacy-text]").forEach(el => { el.textContent = label(el.dataset.privacyText); });
    document.querySelectorAll("[data-privacy-feature]").forEach(button => {
      const allowed = has(button.dataset.privacyFeature);
      button.textContent = label(allowed ? "disable" : "enable");
      button.setAttribute("aria-pressed", String(allowed));
    });
  }
  function refreshFeature(feature) {
    if (feature === "suggestions") {
      if (typeof updateSetting === "function") updateSetting("searchSuggestionsEnabled", has(feature));
      if (!has(feature) && typeof cancelPendingSearchSuggestions === "function") cancelPendingSearchSuggestions();
    }
    if (feature === "voice" && !has(feature) && typeof isVoiceSearchListening !== "undefined" && isVoiceSearchListening) {
      voiceSearchAbortRequested = true; voiceSearchRecognition?.stop();
    }
    if (feature === "resources") {
      if (typeof renderCollection === "function") renderCollection();
      if (typeof renderBackground === "function") renderBackground();
      document.querySelectorAll("[data-theme-font]").forEach(link => { if (!has(feature)) link.remove(); });
      if (!has(feature) && typeof loadedThemeFontKey !== "undefined") loadedThemeFontKey = "";
      if (has(feature) && typeof loadThemeFont === "function") loadThemeFont(state.settings.themeStyle);
    }
  }
  function initialize() {
    if (initialized) return;
    initialized = true;
    const host = document.querySelector("[data-privacy-settings]");
    if (host) {
      const heading = node("h5"); heading.dataset.privacyText = "title";
      const summary = node("p", "", "field-note"); summary.dataset.privacyText = "local";
      host.append(heading, summary);
      for (const feature of features) {
        const card = node("div", "", "feature-privacy-card");
        const title = node("strong"); title.dataset.privacyText = feature + "_title";
        const body = node("p", "", "field-note"); body.dataset.privacyText = feature + "_body";
        const button = node("button", "", "secondary-button"); button.type = "button"; button.dataset.privacyFeature = feature;
        button.addEventListener("click", async () => { if (has(feature)) revoke(feature); else await request(feature); });
        card.append(title, body, button); host.append(card);
      }
    }
    window.addEventListener("lunarprivacychange", event => refreshFeature(event.detail.feature));
    window.addEventListener("storage", event => {
      if (event.key === null || event.key.startsWith(prefix)) {
        const changed = event.key === null ? features : [event.key.slice(prefix.length)];
        changed.forEach(feature => { blocked.delete(feature); refreshFeature(feature); });
        localize();
      }
    });
    localize();
  }
  window.lunarPrivacy = {has, request, revoke, allowsUrl, initialize, localize};
})();
