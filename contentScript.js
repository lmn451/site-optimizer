function optimizePage() {
  // Performance monitoring
  const perfData = {
    metrics: {},
    resources: [],
  };

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

  // Image optimization
  function optimizeImages() {
    const images = document.querySelectorAll("img");
    images.forEach((img) => {
      // Set loading attribute
      if (!img.loading) img.loading = "lazy";

      // Add error handling
      img.onerror = () => {
        img.style.display = "none";
      };

      // Optional: Downgrade image quality for faster loading
      if (img.src.includes("http")) {
        const originalSrc = img.src;
        img.setAttribute("data-original-src", originalSrc);
      }
    });
  }

  // Script optimization
  function optimizeScripts() {
    const scripts = document.querySelectorAll("script[src]");
    scripts.forEach((script) => {
      if (!script.async && !script.defer) {
        script.defer = true;
      }
    });
  }

  // Initialize optimizations
  optimizeImages();
  optimizeScripts();

  // Report performance data
  window.addEventListener("load", () => {
    chrome.runtime.sendMessage({
      type: "PERFORMANCE_DATA",
      data: perfData,
    });
  });
}

// Run optimizations
optimizePage();
