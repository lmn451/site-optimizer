let isExtensionEnabled = true;

// Initialize extension state
chrome.storage.local.get("enabled", ({ enabled = true }) => {
  isExtensionEnabled = enabled;
  if (isExtensionEnabled) {
    optimizePage();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTENSION_ENABLED_CHANGED") {
    isExtensionEnabled = message.enabled;
    if (!isExtensionEnabled) {
      cleanup();
    } else {
      optimizePage();
    }
    sendResponse({ success: true }); // Acknowledge receipt
  }
});

function optimizeImages() {
  const unoptimizedImages = document.querySelectorAll(
    "img:not([data-optimized])"
  );
  if (!unoptimizedImages.length) return;

  // Create worker using Blob URL
  const workerCode = `
    self.onmessage = function(e) {
      const { images, chunkSize } = e.data;

      // Process images data in chunks
      for (let i = 0; i < images.length; i += chunkSize) {
        const chunk = images.slice(i, i + chunkSize);
        const optimizedChunk = chunk.map(img => ({
          ...img,
          shouldOptimize: shouldOptimizeImage(img),
          optimizationData: generateOptimizationData(img)
        }));

        self.postMessage({
          type: 'CHUNK_PROCESSED',
          chunk: optimizedChunk,
          isLastChunk: i + chunkSize >= images.length
        });
      }
    };

    function shouldOptimizeImage(img) {
      const { src, dataSrc, isOptimized, hasLazyLoad } = img;
      // Don't optimize if already handled by site's lazy loading
      if (hasLazyLoad || isOptimized) return false;

      const finalSrc = dataSrc || src;
      return finalSrc?.includes('http') && !finalSrc?.endsWith('.svg');
    }

    function generateOptimizationData(img) {
      const { src, dataSrc } = img;
      const finalSrc = dataSrc || src;

      return {
        src: finalSrc,
        // Only set srcset if we have a valid source
        srcset: finalSrc?.includes('http') ? \`\${finalSrc} 1x, \${finalSrc} 2x\` : null,
        sizes: "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
        loading: "lazy",
        decoding: "async"
      };
    }
  `;

  const blob = new Blob([workerCode], { type: "text/javascript" });
  const worker = new Worker(URL.createObjectURL(blob));

  // Prepare image data for worker
  const imageData = Array.from(unoptimizedImages).map((img) => ({
    src: img.src,
    dataSrc:
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original"),
    isOptimized: img.hasAttribute("data-optimized"),
    hasLazyLoad:
      img.classList.contains("lazyloaded") ||
      img.hasAttribute("data-ll-status"),
  }));

  worker.onmessage = function (e) {
    const { type, chunk, isLastChunk } = e.data;

    if (type === "CHUNK_PROCESSED") {
      requestIdleCallback(
        () => {
          applyOptimizations(chunk, unoptimizedImages);

          if (isLastChunk) {
            worker.terminate();
            URL.revokeObjectURL(worker.objectURL);
          }
        },
        { timeout: 1000 }
      );
    }
  };

  // Start worker
  worker.postMessage({
    images: imageData,
    chunkSize: 10,
  });
}

function applyOptimizations(optimizedChunk, domImages) {
  optimizedChunk.forEach((optimizedData, index) => {
    if (!optimizedData.shouldOptimize) return;

    const img = domImages[index];
    const { src, srcset, sizes, loading, decoding } =
      optimizedData.optimizationData;

    // Don't modify images that are already loaded
    if (img.complete && img.naturalWidth > 0) return;

    // Apply optimizations
    if (!img.loading) {
      img.loading = loading;
      img.decoding = decoding;
    }

    // Only set srcset if we have one and the image isn't already handled
    if (srcset && !img.srcset && !img.hasAttribute("data-ll-status")) {
      img.srcset = srcset;
      img.sizes = sizes;
    }

    // Set fetch priority based on viewport visibility
    img.fetchPriority = isInViewport(img) ? "high" : "low";

    // Don't hide images that are already visible
    if (img.style.display === "none" && !img.hasAttribute("data-ll-status")) {
      img.style.removeProperty("display");
    }

    img.setAttribute("data-optimized", "true");
  });
}

function handleSVGImage(img, dataSrc) {
  if (
    dataSrc &&
    !dataSrc.endsWith(".svg") &&
    !img.classList.contains("lazyloaded")
  ) {
    const originalSrc = img.src;
    img.src = dataSrc;
    img.onerror = () => (img.src = originalSrc);
  }
}

function optimizeScripts() {
  // More specific selector
  const scripts = document.querySelectorAll(
    "script[src]:not([async]):not([defer]):not([data-optimized])"
  );

  if (!scripts.length) return;

  requestIdleCallback(
    () => {
      scripts.forEach((script) => {
        script.defer = true;
        script.setAttribute("data-optimized", "true");
      });
    },
    { timeout: 1000 }
  );
}

function shouldSkipElement(element) {
  // Skip check if element is null or not an Element
  if (!element || !(element instanceof Element)) {
    return false;
  }

  // Helper function to safely get class string
  const getClassString = (el) => {
    if (el.className instanceof SVGAnimatedString) {
      return el.className.baseVal.toLowerCase();
    }
    return (typeof el.className === "string" ? el.className : "").toLowerCase();
  };

  // Check element and its parents for modal/menu related attributes and classes
  const skipSelectors = [
    '[role="menu"]',
    '[role="navigation"]',
    '[role="dialog"]',
    '[role="modal"]',
    ".modal",
    ".dropdown",
    ".menu",
    ".nav",
    ".popup",
    '[aria-haspopup="true"]',
    "[aria-expanded]",
    '[data-toggle="dropdown"]',
    '[data-toggle="modal"]',
  ];

  // Check if element or any parent matches skip conditions
  const hasSkipSelector = skipSelectors.some((selector) => {
    return (
      element.matches(selector) ||
      element.closest(selector) ||
      // Check if any child elements match the selector
      (element.querySelector && element.querySelector(selector))
    );
  });

  // Check class names and text content for menu-related terms
  const menuTerms = [
    "menu",
    "nav",
    "dropdown",
    "popup",
    "modal",
    "dialog",
    "submenu",
    "navbar",
    "navigation",
    "drawer",
    "sidebar",
    "overlay",
    "offcanvas",
  ];

  // Check element and its parents
  const checkElementAndParents = (el) => {
    while (el && el instanceof Element) {
      const classString = getClassString(el);
      const idString = el.id.toLowerCase();
      const textContent = el.textContent?.toLowerCase() || "";

      // Check for menu terms in class, id, or text
      if (
        menuTerms.some(
          (term) =>
            classString.includes(term) ||
            idString.includes(term) ||
            (term === "menu" && textContent.includes(term))
        )
      ) {
        return true;
      }

      // Check data attributes
      if (
        Array.from(el.attributes).some((attr) => {
          const name = attr.name.toLowerCase();
          return (
            name.includes("menu") ||
            name.includes("nav") ||
            name.includes("dropdown") ||
            name.includes("modal") ||
            name.includes("dialog") ||
            name.startsWith("data-toggle") ||
            name.startsWith("aria-")
          );
        })
      ) {
        return true;
      }

      el = el.parentElement;
    }
    return false;
  };

  // Check children elements
  const checkChildren = (el) => {
    if (!el.querySelectorAll) return false;

    const children = el.querySelectorAll("*");
    return Array.from(children).some((child) => {
      const classString = getClassString(child);
      const idString = child.id.toLowerCase();

      return menuTerms.some(
        (term) => classString.includes(term) || idString.includes(term)
      );
    });
  };

  return (
    hasSkipSelector || checkElementAndParents(element) || checkChildren(element)
  );
}

// Add performance-optimized DOM utilities
const DOMUtils = {
  // Batch DOM reads
  readDOM(callback) {
    return window.requestAnimationFrame(() => {
      const measurements = callback();
      return measurements;
    });
  },

  // Batch DOM writes
  writeDOM(callback) {
    return window.requestAnimationFrame(() => {
      callback();
    });
  },

  // Create document fragment for batch insertions
  createFragment() {
    return document.createDocumentFragment();
  },

  // Efficiently query elements
  querySelector(selector, context = document) {
    return context.querySelector(selector);
  },

  querySelectorAll(selector, context = document) {
    return Array.from(context.querySelectorAll(selector));
  },

  // Efficient class manipulation
  addClass(element, className) {
    element.classList.add(className);
  },

  removeClass(element, className) {
    element.classList.remove(className);
  },

  // Efficient style manipulation
  setStyles(element, styles) {
    Object.assign(element.style, styles);
  },
};

// Update fixHiddenElements to use performance optimizations
function fixHiddenElements() {
  DOMUtils.readDOM(() => {
    const elements = DOMUtils.querySelectorAll("*");
    const elementsToModify = [];

    elements.forEach((element) => {
      if (shouldSkipElement(element)) return;

      const style = window.getComputedStyle(element);
      const needsModification =
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        element.hasAttribute("hidden") ||
        element.classList.contains("hidden") ||
        element.classList.contains("invisible");

      if (needsModification) {
        const hasAnimationClass = Array.from(element.classList).some(
          (cls) =>
            cls.includes("fade") ||
            cls.includes("animate") ||
            cls.includes("transition") ||
            cls.includes("show") ||
            cls.includes("reveal")
        );

        if (hasAnimationClass && !shouldSkipElement(element)) {
          elementsToModify.push({
            element,
            display:
              element.style.display === "none"
                ? "block"
                : element.style.display,
          });
        }
      }
    });

    DOMUtils.writeDOM(() => {
      elementsToModify.forEach(({ element, display }) => {
        DOMUtils.setStyles(element, {
          display,
          visibility: "visible",
          opacity: "1",
        });
        element.removeAttribute("hidden");
      });
    });
  });
}

// Update fixOpacityAnimations to use performance optimizations
function fixOpacityAnimations() {
  DOMUtils.readDOM(() => {
    const elements = DOMUtils.querySelectorAll("*");
    const modifications = [];

    elements.forEach((element) => {
      if (shouldSkipElement(element)) return;

      const style = window.getComputedStyle(element);

      // Batch all style reads
      const needsTransformFix =
        style.transform.includes("scale(0)") ||
        style.transform.includes("translateY(-100%)") ||
        style.transform.includes("translateX(-100%)");

      const needsClipPathFix =
        style.clipPath === "inset(100%)" || style.clipPath === "circle(0%)";

      const needsOpacityFix =
        style.opacity === "0" &&
        (style.animation ||
          style.transition ||
          style.animationName ||
          element.classList.toString().includes("animate") ||
          element.classList.toString().includes("fade"));

      // Queue modifications
      if (needsTransformFix) {
        modifications.push({
          element,
          type: "transform",
        });
      }

      if (needsClipPathFix) {
        modifications.push({
          element,
          type: "clipPath",
        });
      }

      if (needsOpacityFix) {
        modifications.push({
          element,
          type: "opacity",
        });
      }
    });

    // Batch all DOM writes
    DOMUtils.writeDOM(() => {
      modifications.forEach(({ element, type }) => {
        switch (type) {
          case "transform":
            element.style.setProperty("transform", "none", "important");
            break;
          case "clipPath":
            element.style.setProperty("clip-path", "none", "important");
            break;
          case "opacity":
            DOMUtils.setStyles(element, {
              opacity: "1",
              visibility: "visible",
            });
            element.style.removeProperty("animation");
            element.style.removeProperty("transition");
            break;
        }
      });
    });
  });
}

function optimizePage() {
  if (!isExtensionEnabled) return;

  try {
    const observer = new MutationObserver((mutations) => {
      let hasNewImages = false;
      let hasNewElements = false;
      let hasClassChanges = false;

      DOMUtils.readDOM(() => {
        mutations.forEach((mutation) => {
          if (
            mutation.type === "attributes" &&
            (mutation.attributeName === "class" ||
              mutation.attributeName === "style")
          ) {
            hasClassChanges = true;
          }

          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              hasNewElements = true;
              if (
                node.tagName === "IMG" ||
                (node.querySelectorAll &&
                  node.querySelectorAll("img").length > 0)
              ) {
                hasNewImages = true;
              }
            }
          });
        });
      });

      // Batch optimizations
      if (hasNewImages || hasNewElements || hasClassChanges) {
        requestIdleCallback(
          () => {
            DOMUtils.writeDOM(() => {
              if (hasNewImages) optimizeImages();
              if (hasNewElements || hasClassChanges) {
                fixOpacityAnimations();
                fixHiddenElements();
              }
            });
          },
          { timeout: 1000 }
        );
      }
    });

    window.mutationObserver = observer;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
      characterData: false,
    });

    // Initial optimizations
    requestIdleCallback(
      () => {
        DOMUtils.writeDOM(() => {
          optimizeImages();
          optimizeScripts();
          optimizeResourceHints();
          optimizeViewportRendering();
          fixOpacityAnimations();
          fixHiddenElements();
        });
      },
      { timeout: 2000 }
    );
  } catch (error) {
    // Silent fail for observer setup
  }
}

window.addEventListener("DOMContentLoaded", () => {
  optimizePage();
});

function showToast(message) {
  const toast = document.createElement("div");
  toast.innerHTML = message.replace(/\n/g, "<br>");

  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.padding = "10px 20px";
  toast.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
  toast.style.color = "#fff";
  toast.style.borderRadius = "5px";
  toast.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
  toast.style.fontSize = "14px";
  toast.style.zIndex = "100000";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.5s ease, transform 0.5s ease";
  toast.style.transform = "translateY(20px)";

  document.body.appendChild(toast);

  window.getComputedStyle(toast).opacity;
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    toast.addEventListener("transitionend", () => {
      toast.remove();
    });
  }, 3000);
}

function optimizeResourceHints() {
  try {
    // Only proceed if document.head exists
    if (!document.head) return;

    const selector = [
      'img[src^="http"]:not([data-hint-processed])',
      'script[src^="http"]:not([data-hint-processed])',
      'link[rel="stylesheet"][href^="http"]:not([data-hint-processed])',
    ].join(",");

    const resources = document.querySelectorAll(selector);
    if (!resources.length) return;

    const processedDomains = new Set();
    const domains = new Set();
    const fragment = document.createDocumentFragment();

    resources.forEach((element) => {
      try {
        if (!element.src && !element.href) return;
        const url = element.src || element.href;
        const domain = new URL(url).origin;
        if (!domain) return;

        domains.add(domain);
        element.setAttribute("data-hint-processed", "true");
      } catch {}
    });

    if (domains.size > 0) {
      requestIdleCallback(
        () => {
          try {
            domains.forEach((domain) => {
              if (
                !processedDomains.has(domain) &&
                domain !== window.location.origin &&
                domain.startsWith("http")
              ) {
                const [preconnect, dnsPrefetch] = createResourceHints(domain);
                fragment.appendChild(preconnect);
                fragment.appendChild(dnsPrefetch);
                processedDomains.add(domain);
              }
            });
            document.head?.appendChild(fragment);
          } catch {}
        },
        { timeout: 1000 }
      );
    }
  } catch {}
}

function createResourceHints(domain) {
  const preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = domain;
  preconnect.crossOrigin = "anonymous";

  const dnsPrefetch = document.createElement("link");
  dnsPrefetch.rel = "dns-prefetch";
  dnsPrefetch.href = domain;

  return [preconnect, dnsPrefetch];
}

function isInViewport(element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <=
      (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

function optimizeViewportRendering() {
  try {
    if (!("IntersectionObserver" in window)) return;

    const observerOptions = {
      rootMargin: "200px 0px",
      threshold: [0, 0.1],
    };

    const observer = new IntersectionObserver((entries) => {
      try {
        entries.forEach((entry) => {
          const target = entry.target;
          if (!target?.classList?.contains("optimize-viewport")) return;

          if (entry.isIntersecting) {
            target.style.contentVisibility = "visible";
            if (entry.intersectionRatio > 0.1) {
              target.style.contain = "none";
            }
          } else {
            target.style.contentVisibility = "auto";
            target.style.contain = "content";
          }
        });
      } catch {}
    }, observerOptions);

    window.intersectionObserver = observer;
  } catch {}
}

// Add cleanup function for observers
function cleanup() {
  if (window.performanceObserver) {
    window.performanceObserver.disconnect();
  }
  if (window.mutationObserver) {
    window.mutationObserver.disconnect();
  }
  if (window.intersectionObserver) {
    window.intersectionObserver.disconnect();
  }
}

// Store observers globally
window.addEventListener("unload", cleanup);
