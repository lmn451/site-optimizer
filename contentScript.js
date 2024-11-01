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

function optimizePage() {
  try {
    const observer = new MutationObserver((mutations) => {
      try {
        let hasNewImages = false;
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (
              node.tagName === "IMG" ||
              (node.querySelectorAll && node.querySelectorAll("img").length > 0)
            ) {
              hasNewImages = true;
            }
          });
        });

        if (hasNewImages) {
          optimizeImages();
        }
      } catch (error) {
        // Silent fail for mutation processing
      }
    });

    window.mutationObserver = observer;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });

    // Initial optimizations with error handling
    requestIdleCallback(
      () => {
        try {
          optimizeImages();
          optimizeScripts();
          optimizeResourceHints();
          optimizeViewportRendering();
        } catch (error) {
          // Silent fail for initial optimizations
        }
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

    // Rest of the function...
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
