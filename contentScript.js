function optimizePage() {
  console.log("Starting optimizations...");

  // Performance monitoring
  const perfData = {
    metrics: {},
    resources: [],
  };
  let imageOptimizations = 0;
  let scriptOptimizations = 0;
  // Monitor performance
  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      if (entry.entryType === "resource") {
        perfData.resources.push({
          name: entry.name,
          duration: entry.duration,
          size: entry.transferSize,
        });
      }
      if (entry.entryType === "paint") {
        perfData.metrics[entry.name] = entry.startTime;
      }
    });
  });

  observer.observe({
    entryTypes: ["resource", "paint", "largest-contentful-paint"],
  });

  const domObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName === "IMG") {
          optimizeImages();
        } else if (node.querySelectorAll) {
          const imgs = node.querySelectorAll("img");
          if (imgs.length > 0) {
            optimizeImages();
          }
        }
      });
    });
  });

  domObserver.observe(document.body, { childList: true, subtree: true });

  // Image optimization
  function optimizeImages() {
    const images = document.querySelectorAll("img");
    images.forEach((img) => {
      // Handle images with various lazy loading attributes
      const dataSrc =
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-original");
      const currentSrc = img.src;
      const loadStatus = img.getAttribute("data-ll-status");

      // Skip already optimized images
      if (img.hasAttribute("data-optimized")) {
        return;
      }

      // If image is already loaded via lazy loading, mark as optimized
      if (loadStatus === "loaded" || img.classList.contains("lazyloaded")) {
        img.setAttribute("data-optimized", "true");
        console.log("Image already lazy loaded:", dataSrc || currentSrc);
        return;
      }

      // Handle SVG placeholder case
      if (
        currentSrc.includes("data:image/svg+xml") ||
        currentSrc.endsWith(".svg")
      ) {
        if (dataSrc && !dataSrc.endsWith(".svg")) {
          // Only replace if not already handled by site's lazy loading
          if (!img.classList.contains("lazyloaded")) {
            const originalSrc = img.src;
            img.src = dataSrc;
            imageOptimizations++;
            console.log(
              `Replaced SVG placeholder with actual image: ${dataSrc}`
            );

            // Fallback if the new source fails
            img.onerror = () => {
              console.log(
                `Failed to load ${dataSrc}, reverting to ${originalSrc}`
              );
              img.src = originalSrc;
            };
          }
        }
        // Skip srcset generation for SVG images
        img.setAttribute("data-optimized", "true");
        return;
      }

      const src = dataSrc || currentSrc;

      if (src && src.includes("http") && !src.endsWith(".svg")) {
        // Set loading attribute if not set
        if (!img.loading) {
          img.loading = "lazy";
          img.decoding = "async";
          imageOptimizations++;
        }

        // Add error handling only if not already handled
        if (!img.hasAttribute("data-error-handler")) {
          img.onerror = () => {
            if (dataSrc && img.src !== dataSrc) {
              console.log(`Attempting to load data-lazy-src: ${dataSrc}`);
              img.src = dataSrc;
            } else {
              console.log(`Image failed to load: ${src}`);
              // Try to load a smaller version or placeholder
              if (img.srcset) {
                const smallestSrc = img.srcset.split(",")[0].split(" ")[0];
                if (!smallestSrc.endsWith(".svg")) {
                  img.src = smallestSrc;
                }
              }
            }
          };
          img.setAttribute("data-error-handler", "true");
        }

        // Optimize if not already handled by site's lazy loading
        if (
          !img.classList.contains("lazyloaded") &&
          !img.hasAttribute("data-original-src")
        ) {
          img.setAttribute("data-original-src", src);

          // Generate responsive srcset if not present and if not SVG
          if (!img.srcset) {
            // Use density descriptors instead of width descriptors
            img.srcset = `${src} 1x, ${src} 2x`;

            // Set sizes attribute for responsive images
            img.sizes =
              "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw";
          }

          // Add fetchpriority for images likely to be in viewport
          if (isInViewport(img)) {
            img.fetchPriority = "high";
          } else {
            img.fetchPriority = "low";
          }

          imageOptimizations++;
          console.log(`Optimized image: ${src}`);
        }

        // Ensure image is visible but maintain original display style
        if (img.style.display === "none") {
          img.style.removeProperty("display");
        }

        // Mark as optimized
        img.setAttribute("data-optimized", "true");
      }
    });
  }

  // Script optimization
  function optimizeScripts() {
    const scripts = document.querySelectorAll("script[src]");
    scripts.forEach((script) => {
      if (!script.async && !script.defer) {
        script.defer = true;
        scriptOptimizations++;
      }
    });
  }

  // Initialize optimizations
  optimizeImages();
  optimizeScripts();

  // Calculate total optimizations
  const totalImages = imageOptimizations;
  const totalScripts = scriptOptimizations;
  const totalOptimizations = totalImages + totalScripts;

  // Show toast message
  showToast(
    `Optimizations completed:\nImages optimized: ${totalImages}\nScripts optimized: ${totalScripts}`
  );

  console.log(
    `Optimizations completed: Images optimized: ${totalImages}, Scripts optimized: ${totalScripts}`
  );

  // Report performance data
  window.addEventListener("load", () => {
    chrome.runtime.sendMessage({
      type: "PERFORMANCE_DATA",
      data: perfData,
    });
    console.log("Performance data sent."); // Debugging log
  });

  // Add this line after the existing optimizations
  optimizeResourceHints();

  // Add this line after the existing optimizations
  optimizeViewportRendering();
}

// Run optimizations and inject icons after DOM is loaded
window.addEventListener("DOMContentLoaded", () => {
  console.log("DOM fully loaded and parsed.");
  optimizePage();
});

function showToast(message) {
  console.log("Attempting to show toast:", message); // Debugging log

  const toast = document.createElement("div");
  toast.innerHTML = message.replace(/\n/g, "<br>");

  // Enhanced styling to ensure visibility
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.padding = "10px 20px";
  toast.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
  toast.style.color = "#fff";
  toast.style.borderRadius = "5px";
  toast.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
  toast.style.fontSize = "14px";
  toast.style.zIndex = "100000"; // Increased z-index to ensure it appears on top
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.5s ease, transform 0.5s ease";
  toast.style.transform = "translateY(20px)"; // Start slightly below

  document.body.appendChild(toast);

  // Trigger reflow to enable transition
  window.getComputedStyle(toast).opacity;
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)"; // Slide up into view

  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)"; // Slide down out of view
    toast.addEventListener("transitionend", () => {
      toast.remove();
      console.log("Toast removed."); // Debugging log
    });
  }, 3000);
}

function optimizeResourceHints() {
  // Track domains we've already handled
  const processedDomains = new Set();

  // Collect unique domains from various resources
  const domains = new Set();

  // Scan images
  document.querySelectorAll('img[src^="http"]').forEach((img) => {
    try {
      const domain = new URL(img.src).origin;
      domains.add(domain);
    } catch (e) {}
  });

  // Scan scripts
  document.querySelectorAll('script[src^="http"]').forEach((script) => {
    try {
      const domain = new URL(script.src).origin;
      domains.add(domain);
    } catch (e) {}
  });

  // Scan stylesheets
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    try {
      const domain = new URL(link.href).origin;
      domains.add(domain);
    } catch (e) {}
  });

  // Add resource hints
  domains.forEach((domain) => {
    if (!processedDomains.has(domain) && domain !== window.location.origin) {
      const hint = document.createElement("link");
      hint.rel = "preconnect";
      hint.href = domain;
      hint.crossOrigin = "anonymous";
      document.head.appendChild(hint);

      // Add DNS-prefetch as fallback
      const dnsPrefetch = document.createElement("link");
      dnsPrefetch.rel = "dns-prefetch";
      dnsPrefetch.href = domain;
      document.head.appendChild(dnsPrefetch);

      processedDomains.add(domain);
    }
  });

  // Scan for next page links
  document.querySelectorAll('a[href^="/"], a[href^="http"]').forEach((link) => {
    try {
      const url = new URL(link.href, window.location.origin);
      if (
        url.origin === window.location.origin &&
        !link.href.includes("#") &&
        isInViewport(link)
      ) {
        const prefetch = document.createElement("link");
        prefetch.rel = "prefetch";
        prefetch.href = url.href;
        document.head.appendChild(prefetch);
      }
    } catch (e) {}
  });
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
  // Add base styles for viewport optimization
  const style = document.createElement("style");
  style.textContent = `
    .optimize-viewport {
      content-visibility: auto;
      contain-intrinsic-size: 0 500px;
      contain: content;
    }
  `;
  document.head.appendChild(style);

  // Target common content containers
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

  // Handle dynamic content with Intersection Observer
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
      rootMargin: "200px 0px", // Pre-render content 200px before it enters viewport
      threshold: 0,
    }
  );

  containers.forEach((container) => observer.observe(container));

  // Handle iframes and embeds
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
