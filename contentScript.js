(() => {
  "use strict";

  const { normalizeSettings, AD_DOMAINS = [] } = globalThis.OptimizerSettings;
  const api = globalThis.browser || globalThis.chrome;
  let settings;
  let revision = 0;
  let running = false;
  let suspended = false;
  let mutationObserver;
  let intersectionObserver;
  let frame = null;
  let animationStyle;
  const pendingRoots = new Set();
  const observed = new Set();
  const attributes = new Map();
  const styles = new Map();
  const hints = new Map();
  const selector = 'img, iframe, .optimize-viewport, script[src], link[rel="stylesheet"]';

  // Restore only values still owned by us. A site's later edits must win.
  function setAttribute(element, name, value) {
    if (element.getAttribute(name) === value) return;
    let changes = attributes.get(element);
    if (!changes) attributes.set(element, (changes = new Map()));
    const previous = changes.get(name);
    if (!previous || element.getAttribute(name) !== previous.applied) {
      changes.set(name, { original: element.getAttribute(name), applied: value });
    } else {
      previous.applied = value;
    }
    element.setAttribute(name, value);
  }

  function restoreAttributes(element, changes) {
    for (const [name, { original, applied }] of changes) {
      if (element.getAttribute(name) !== applied) continue;
      if (original === null) element.removeAttribute(name);
      else element.setAttribute(name, original);
    }
  }

  function setStyle(element, name, value) {
    const current = element.style.getPropertyValue(name);
    const priority = element.style.getPropertyPriority(name);
    if (current === value && priority === "") return;
    let changes = styles.get(element);
    if (!changes) styles.set(element, (changes = new Map()));
    const previous = changes.get(name);
    if (!previous || current !== previous.applied || priority !== "") {
      changes.set(name, { original: current, priority, applied: value });
    } else {
      previous.applied = value;
    }
    element.style.setProperty(name, value);
  }

  function restoreStyles(element, changes) {
    for (const [name, { original, priority, applied }] of changes) {
      if (element.style.getPropertyValue(name) !== applied ||
          element.style.getPropertyPriority(name) !== "") continue;
      if (original) element.style.setProperty(name, original, priority);
      else element.style.removeProperty(name);
    }
  }

  function inViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function optimizeMedia(element) {
    if (element.tagName !== "IMG" && element.tagName !== "IFRAME") return;
    const offscreen = !inViewport(element);
    const siteManaged = element.hasAttribute("data-src") ||
      element.hasAttribute("data-lazy-src") || element.hasAttribute("data-original") ||
      element.hasAttribute("data-ll-status") || element.classList.contains("lazyloaded");
    if (settings.config.lazyLoad && offscreen && !siteManaged &&
        !element.hasAttribute("loading") &&
        !(element.tagName === "IMG" && element.complete)) {
      setAttribute(element, "loading", "lazy");
    }
    if (settings.config.imageOptimization && element.tagName === "IMG") {
      if (!element.hasAttribute("decoding")) setAttribute(element, "decoding", "async");
      if (offscreen && !element.complete && !element.hasAttribute("fetchpriority")) {
        setAttribute(element, "fetchpriority", "low");
      }
    }
    // Never invent srcset candidates, replace sources, or expose hidden elements.
  }

  function addResourceHints(element) {
    if (!settings.config.preload || !document.head) return;
    // A deferred image or iframe may not be intended to contact its origin yet.
    if (element.tagName === "IFRAME") return;
    if (element.tagName === "IMG" && !inViewport(element) &&
        (element.getAttribute("loading") === "lazy" ||
         element.hasAttribute("data-src") || element.hasAttribute("data-lazy-src") ||
         element.hasAttribute("data-original") || element.hasAttribute("data-ll-status"))) return;
    const source = element.getAttribute("src") ||
      (element.tagName === "LINK" ? element.getAttribute("href") : null);
    if (!source) return;
    let url;
    try { url = new URL(source, document.baseURI); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) return;
    if (settings.config.blockAds && AD_DOMAINS.some((domain) =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return;
    if (hints.has(url.origin) || hints.size >= 6) return;
    const existing = Array.from(document.querySelectorAll('link[rel~="preconnect"]'));
    if (existing.some((link) => link.href === `${url.origin}/` || link.href === url.origin)) return;
    const nodes = [];
    for (const rel of ["preconnect", "dns-prefetch"]) {
      const link = document.createElement("link");
      link.rel = rel;
      link.href = url.origin;
      if (rel === "preconnect") link.crossOrigin = "anonymous";
      document.head.appendChild(link);
      nodes.push(link);
    }
    hints.set(url.origin, nodes);
  }

  function processElement(element) {
    if (!element.isConnected) return;
    optimizeMedia(element);
    addResourceHints(element);
    if (!intersectionObserver) return;
    const eligible = element.classList.contains("optimize-viewport");
    if (eligible && !observed.has(element)) {
      observed.add(element);
      intersectionObserver.observe(element);
    } else if (!eligible && observed.delete(element)) {
      intersectionObserver.unobserve(element);
      const changes = styles.get(element);
      if (changes) restoreStyles(element, changes);
      styles.delete(element);
    }
  }

  function ensureAnimationStyle() {
    if (!settings.config.noAnimation || animationStyle?.isConnected) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    animationStyle = document.createElement("style");
    animationStyle.dataset.earlyPerformanceOptimizer = "animations";
    // Let animation events and final keyframes run, without visible motion.
    // Do not force opacity, display, visibility, or hidden attributes.
    animationStyle.textContent = `*, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      transition-delay: 0s !important;
    }`;
    parent.appendChild(animationStyle);
  }

  function pruneDetachedElements() {
    for (const [element, changes] of attributes) {
      if (!element.isConnected) {
        restoreAttributes(element, changes);
        attributes.delete(element);
      }
    }
    for (const [element, changes] of styles) {
      if (!element.isConnected) {
        restoreStyles(element, changes);
        styles.delete(element);
      }
    }
    for (const element of observed) {
      if (!element.isConnected) {
        intersectionObserver?.unobserve(element);
        observed.delete(element);
      }
    }
  }

  function flush() {
    frame = null;
    if (!running) return;
    ensureAnimationStyle();
    pruneDetachedElements();
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const root of roots) {
      if (root !== document && !root.isConnected) continue;
      if (root.nodeType === 1) processElement(root);
      root.querySelectorAll?.(selector).forEach(processElement);
    }
  }

  function schedule(root = document) {
    if (!running) return;
    pendingRoots.add(root);
    if (frame === null) frame = window.requestAnimationFrame(flush);
  }

  function start() {
    if (running || suspended || !settings?.enabled) return;
    running = true;
    if (settings.config.imageOptimization && "IntersectionObserver" in window) {
      intersectionObserver = new IntersectionObserver((entries) => {
        if (!running) return;
        for (const entry of entries) {
          if (observed.has(entry.target)) {
            setStyle(entry.target, "content-visibility", entry.isIntersecting ? "visible" : "auto");
          }
        }
      }, { rootMargin: "200px 0px", threshold: 0 });
    }
    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") schedule(mutation.target);
        else {
          // Read mutation records synchronously, before scheduling the writes.
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && node !== animationStyle &&
                !Array.from(hints.values()).some((nodes) => nodes.includes(node))) schedule(node);
          }
          if (mutation.removedNodes.length) schedule();
        }
      }
    });
    mutationObserver.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "src", "href", "loading", "decoding", "fetchpriority"],
    });
    ensureAnimationStyle();
    schedule();
  }

  function cleanup() {
    running = false;
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    mutationObserver = intersectionObserver = undefined;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    pendingRoots.clear();
    observed.clear();
    animationStyle?.remove();
    animationStyle = undefined;
    for (const nodes of hints.values()) for (const node of nodes) node.remove();
    hints.clear();
    for (const [element, changes] of attributes) restoreAttributes(element, changes);
    for (const [element, changes] of styles) restoreStyles(element, changes);
    attributes.clear();
    styles.clear();
  }

  async function refreshSettings() {
    const current = ++revision;
    try {
      const next = normalizeSettings(await api.storage.local.get(["enabled", "config"]));
      if (current !== revision) return;
      if (JSON.stringify(settings) === JSON.stringify(next)) return;
      cleanup();
      settings = next;
      start();
    } catch (error) {
      console.error("Unable to load optimizer settings:", error);
    }
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.config)) void refreshSettings();
  });
  window.addEventListener("pagehide", () => {
    suspended = true;
    revision++;
    cleanup();
  });
  window.addEventListener("pageshow", () => {
    suspended = false;
    void refreshSettings().then(start);
  });
  void refreshSettings();
})();
