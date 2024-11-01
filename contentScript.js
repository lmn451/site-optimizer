function optimizeImages() {
  const images = document.querySelectorAll("img");

  images.forEach((img) => {
    const dataSrc =
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original");
    const currentSrc = img.src;
    const loadStatus = img.getAttribute("data-ll-status");

    if (img.hasAttribute("data-optimized")) {
      return;
    }

    if (loadStatus === "loaded" || img.classList.contains("lazyloaded")) {
      img.setAttribute("data-optimized", "true");
      return;
    }

    if (
      currentSrc.includes("data:image/svg+xml") ||
      currentSrc.endsWith(".svg")
    ) {
      if (dataSrc && !dataSrc.endsWith(".svg")) {
        if (!img.classList.contains("lazyloaded")) {
          const originalSrc = img.src;
          img.src = dataSrc;

          img.onerror = () => {
            img.src = originalSrc;
          };
        }
      }
      img.setAttribute("data-optimized", "true");
      return;
    }

    const src = dataSrc || currentSrc;

    if (src && src.includes("http") && !src.endsWith(".svg")) {
      if (!img.loading) {
        img.loading = "lazy";
        img.decoding = "async";
      }

      if (!img.hasAttribute("data-error-handler")) {
        img.onerror = () => {
          if (dataSrc && img.src !== dataSrc) {
            img.src = dataSrc;
          } else if (img.srcset) {
            const smallestSrc = img.srcset.split(",")[0].split(" ")[0];
            if (!smallestSrc.endsWith(".svg")) {
              img.src = smallestSrc;
            }
          }
        };
        img.setAttribute("data-error-handler", "true");
      }

      if (
        !img.classList.contains("lazyloaded") &&
        !img.hasAttribute("data-original-src")
      ) {
        img.setAttribute("data-original-src", src);

        if (!img.srcset) {
          img.srcset = `${src} 1x, ${src} 2x`;
          img.sizes =
            "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw";
        }

        if (isInViewport(img)) {
          img.fetchPriority = "high";
        } else {
          img.fetchPriority = "low";
        }
      }

      if (img.style.display === "none") {
        img.style.removeProperty("display");
      }

      img.setAttribute("data-optimized", "true");
    }
  });
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

  optimizeImages();
  optimizeScripts();
  optimizeResourceHints();
  optimizeViewportRendering();
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

  document.querySelectorAll('img[src^="http"]').forEach((img) => {
    try {
      const domain = new URL(img.src).origin;
      domains.add(domain);
    } catch (e) {}
  });

  document.querySelectorAll('script[src^="http"]').forEach((script) => {
    try {
      const domain = new URL(script.src).origin;
      domains.add(domain);
    } catch (e) {}
  });

  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    try {
      const domain = new URL(link.href).origin;
      domains.add(domain);
    } catch (e) {}
  });

  domains.forEach((domain) => {
    if (!processedDomains.has(domain) && domain !== window.location.origin) {
      const hint = document.createElement("link");
      hint.rel = "preconnect";
      hint.href = domain;
      hint.crossOrigin = "anonymous";
      document.head.appendChild(hint);

      const dnsPrefetch = document.createElement("link");
      dnsPrefetch.rel = "dns-prefetch";
      dnsPrefetch.href = domain;
      document.head.appendChild(dnsPrefetch);

      processedDomains.add(domain);
    }
  });

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
