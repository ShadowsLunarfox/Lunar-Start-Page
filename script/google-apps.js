// Local Google-service shortcuts. No account data, cookies or remote UI are read.
(() => {
  const vectorIcons = new Set(["search", "gmail", "meet", "chat", "drive", "calendar", "docs", "sheets", "slides", "keep"]);
  const catalog = [
    ["search", "https://www.google.com/"],
    ["maps", "https://maps.google.com/"], ["youtube", "https://www.youtube.com/"],
    ["play", "https://play.google.com/"], ["news", "https://news.google.com/"],
    ["gmail", "https://mail.google.com/"], ["meet", "https://meet.google.com/"],
    ["chat", "https://chat.google.com/"], ["drive", "https://drive.google.com/"],
    ["business", "https://business.google.com/"], ["gemini", "https://gemini.google.com/"],
    ["calendar", "https://calendar.google.com/"], ["photos", "https://photos.google.com/"],
    ["translate", "https://translate.google.com/"], ["docs", "https://docs.google.com/document/"],
    ["sheets", "https://docs.google.com/spreadsheets/"], ["slides", "https://docs.google.com/presentation/"],
    ["contacts", "https://contacts.google.com/"], ["keep", "https://keep.google.com/"]
  ].map(([id, url]) => Object.freeze({id, url, icon:`${id}.${vectorIcons.has(id) ? "svg" : id === "maps" || id === "photos" ? "webp" : "png"}`}));
  const scriptUrl = typeof document === "undefined" ? null : document.currentScript?.src;
  const iconBase = scriptUrl ? new URL("../resource/icons/google-apps/", scriptUrl) : null;
  let button, panel, content, heading, initialized = false;
  const label = key => typeof t === "function" ? t(`google_apps.${key}`) : key;

  function tile(app) {
    const element = document.createElement("a");
    element.className = "google-apps-tile";
    element.id = `google-apps-link-${app.id}`;
    element.href = app.url;
    element.target = "_blank";
    element.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.src = new URL(app.icon + "?v=20261101", iconBase).href;
    image.width = image.height = 40;
    image.alt = "";
    image.loading = "lazy";
    const name = document.createElement("span");
    name.textContent = label(`services.${app.id}`);
    element.title = name.textContent;
    element.append(image, name);
    return element;
  }

  function render() {
    if (!initialized || panel.hidden) return;
    const focusId = panel.contains(document.activeElement) ? document.activeElement.id : "";
    heading.textContent = label("title");
    const list = document.createElement("ul");
    list.className = "google-apps-grid";
    for (const app of catalog) {
      const item = document.createElement("li");
      item.append(tile(app));
      list.append(item);
    }
    const footer = document.createElement("div");
    footer.className = "google-apps-footer";
    const more = document.createElement("a");
    more.href = "https://about.google/products/";
    more.target = "_blank";
    more.rel = "noopener noreferrer";
    more.textContent = label("all_products");
    footer.append(more);
    content.replaceChildren(list, footer);
    if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
  }

  function close(restoreFocus = true) {
    if (!initialized || panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus({preventScroll:true});
  }

  function localize() {
    if (!initialized) return;
    button.setAttribute("aria-label", label("title"));
    button.title = label("title");
    panel.querySelector("[data-apps-close]").setAttribute("aria-label", label("close"));
    render();
  }

  function initialize() {
    button = document.getElementById("google-apps-toggle");
    panel = document.getElementById("google-apps-panel");
    if (initialized || !button || !panel) return;
    initialized = true;
    content = panel.querySelector(".google-apps-content");
    heading = document.getElementById("google-apps-heading");
    button.addEventListener("click", () => {
      if (!panel.hidden) { close(); return; }
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      render();
      panel.querySelector(".google-apps-tile")?.focus({preventScroll:true});
    });
    panel.querySelector("[data-apps-close]").addEventListener("click", () => close());
    content.addEventListener("click", event => { if (event.target.closest("a")) close(false); });
    document.addEventListener("pointerdown", event => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close(false); }, true);
    document.addEventListener("focusin", event => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close(false); });
    document.addEventListener("keydown", event => {
      if (panel.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      const grid = event.target instanceof Element ? event.target.closest(".google-apps-grid") : null;
      if (!grid || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const tiles = [...grid.querySelectorAll(".google-apps-tile")], index = tiles.indexOf(event.target);
      if (index < 0) return;
      const next = event.key === "Home" ? 0 : event.key === "End" ? tiles.length - 1 : Math.max(0, Math.min(tiles.length - 1, index + ({ArrowLeft:-1, ArrowRight:1, ArrowUp:-3, ArrowDown:3})[event.key]));
      event.preventDefault();
      tiles[next].focus();
    }, true);
    window.addEventListener("pagehide", () => close(false));
    localize();
  }
  globalThis.lunarGoogleApps = {initialize, localize, catalog:Object.freeze(catalog)};
})();
