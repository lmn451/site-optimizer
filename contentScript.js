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
      return !isOptimized &&
             !hasLazyLoad &&
             (dataSrc || src)?.includes('http') &&
             !(dataSrc || src)?.endsWith('.svg');
    }

    function generateOptimizationData(img) {
      const { src, dataSrc } = img;
      const finalSrc = dataSrc || src;

      return {
        src: finalSrc,
        srcset: \`\${finalSrc} 1x, \${finalSrc} 2x\`,
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
    hasLazyLoad: img.classList.contains("lazyloaded"),
  }));

  // Handle worker messages
  worker.onmessage = function (e) {
    const { type, chunk, isLastChunk } = e.data;

    if (type === "CHUNK_PROCESSED") {
      requestIdleCallback(
        () => {
          applyOptimizations(chunk, unoptimizedImages);

          if (isLastChunk) {
            worker.terminate();
            URL.revokeObjectURL(worker.objectURL); // Clean up the Blob URL
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

    // Apply optimizations
    if (!img.loading) {
      img.loading = loading;
      img.decoding = decoding;
    }

    if (!img.srcset) {
      img.srcset = srcset;
      img.sizes = sizes;
    }

    // Set fetch priority
    img.fetchPriority = isInViewport(img) ? "high" : "low";

    // Ensure visibility
    if (img.style.display === "none") {
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
  const scripts = document.querySelectorAll("script[src]");
  scripts.forEach((script) => {
    if (!script.async && !script.defer) {
      script.defer = true;
    }
  });
}
function optimizePage() {
  // Use a single mutation observer for all changes
  const observer = new MutationObserver((mutations) => {
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

    // Only run optimizeImages once per batch of mutations
    if (hasNewImages) {
      optimizeImages();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  // Initial optimizations
  requestIdleCallback(
    () => {
      optimizeImages();
      optimizeScripts();
      optimizeResourceHints();
      optimizeViewportRendering();
    },
    { timeout: 2000 }
  );
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
  const processedDomains = new Set();
  const domains = new Set();
  const fragment = document.createDocumentFragment();

  // Collect domains
  const resources = [
    ...document.querySelectorAll(
      'img[src^="http"], script[src^="http"], link[rel="stylesheet"][href^="http"]'
    ),
  ];

  resources.forEach((element) => {
    try {
      const url = element.src || element.href;
      const domain = new URL(url).origin;
      domains.add(domain);
    } catch {}
  });

  // Create hints in a batch
  domains.forEach((domain) => {
    if (!processedDomains.has(domain) && domain !== window.location.origin) {
      const [preconnect, dnsPrefetch] = createResourceHints(domain);
      fragment.appendChild(preconnect);
      fragment.appendChild(dnsPrefetch);
      processedDomains.add(domain);
    }
  });

  // Append all hints at once
  requestIdleCallback(
    () => {
      document.head.appendChild(fragment);
    },
    { timeout: 1000 }
  );
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
  const style = document.createElement("style");
  style.textContent = `
    .optimize-viewport {
      content-visibility: auto;
      contain-intrinsic-size: 0 500px;
      contain: content;
    }
  `;
  document.head.appendChild(style);

  const containers = document.querySelectorAll(
    [
      "main",
      "article",
      "section",
      ".content",
      ".post",
      ".article",
      ".product-list",
      ".grid",
      '[role="main"]',
      '[role="article"]',
    ].join(",")
  );

  containers.forEach((container) => {
    if (!container.classList.contains("optimize-viewport")) {
      container.classList.add("optimize-viewport");
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.target.classList.contains("optimize-viewport")) {
          if (entry.isIntersecting) {
            entry.target.style.contentVisibility = "visible";
          } else {
            entry.target.style.contentVisibility = "auto";
          }
        }
      });
    },
    {
      rootMargin: "200px 0px",
      threshold: 0,
    }
  );

  containers.forEach((container) => observer.observe(container));

  document.querySelectorAll("iframe, embed").forEach((element) => {
    if (!element.hasAttribute("loading")) {
      element.loading = "lazy";
    }

    const wrapper = document.createElement("div");
    wrapper.classList.add("optimize-viewport");
    element.parentNode.insertBefore(wrapper, element);
    wrapper.appendChild(element);
  });
}
