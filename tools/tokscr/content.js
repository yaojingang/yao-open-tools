(() => {
  if (window.__tokscrContentLoadedV2) {
    return;
  }

  window.__tokscrContentLoadedV2 = true;

  const STYLE_ID = "__full_page_screenshot_capture_style__";
  const state = {
    prepared: false,
    originalX: 0,
    originalY: 0,
    originalDocumentScrollBehavior: "",
    originalBodyScrollBehavior: "",
    hiddenFloatingElements: [],
    floatingHidden: false
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function getBody() {
    return document.body || document.documentElement;
  }

  function getMetrics() {
    const doc = document.documentElement;
    const body = getBody();
    const totalWidth = Math.ceil(Math.max(
      doc.scrollWidth,
      body.scrollWidth,
      doc.offsetWidth,
      body.offsetWidth,
      doc.clientWidth,
      window.innerWidth
    ));
    const totalHeight = Math.ceil(Math.max(
      doc.scrollHeight,
      body.scrollHeight,
      doc.offsetHeight,
      body.offsetHeight,
      doc.clientHeight,
      window.innerHeight
    ));

    return {
      totalWidth,
      totalHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio || 1,
      title: document.title || location.hostname || "webpage",
      url: location.href
    };
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getClassName(element) {
    return typeof element.className === "string" ? element.className : "";
  }

  function getCleanText(element) {
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisibleElement(element) {
    if (!element || element === document.documentElement) {
      return false;
    }

    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width >= 120 && rect.height >= 120;
  }

  function getDocumentRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      right: rect.right + window.scrollX,
      bottom: rect.bottom + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }

  function hasNoiseMarker(element) {
    const marker = [
      element.tagName,
      element.id,
      getClassName(element),
      element.getAttribute("role") || "",
      element.getAttribute("aria-label") || ""
    ].join(" ").toLowerCase();

    return /(^|\b)(nav|navbar|menu|sidebar|footer|header|comment|related|recommend|share|social|advert|ads|banner|cookie|modal|popup|subscribe|promo|toolbar)(\b|$)/i.test(marker);
  }

  function getLinkTextLength(element) {
    return Array.from(element.querySelectorAll("a")).reduce((total, link) => {
      return total + getCleanText(link).length;
    }, 0);
  }

  function scoreContentElement(element, metrics, semanticBoost) {
    if (!isVisibleElement(element)) {
      return Number.NEGATIVE_INFINITY;
    }

    const rect = getDocumentRect(element);
    const textLength = getCleanText(element).length;
    const mediaCount = element.querySelectorAll("img, video, canvas, pre, table").length;

    if (textLength < 80 && mediaCount < 2) {
      return Number.NEGATIVE_INFINITY;
    }

    const paragraphCount = element.querySelectorAll("p, li, blockquote, pre").length;
    const headingCount = element.querySelectorAll("h1, h2, h3").length;
    const formCount = element.querySelectorAll("input, textarea, select, button").length;
    const linkRatio = getLinkTextLength(element) / Math.max(1, textLength);
    const pageArea = Math.max(1, metrics.totalWidth * metrics.totalHeight);
    const coverage = (rect.width * rect.height) / pageArea;
    const widthRatio = rect.width / Math.max(1, metrics.viewportWidth);

    let score = semanticBoost;
    score += textLength * (1 - Math.min(linkRatio, 0.9));
    score += paragraphCount * 220;
    score += headingCount * 100;
    score += mediaCount * 80;
    score += Math.min(rect.height, 6000) * 0.05;

    if (linkRatio > 0.45) {
      score -= linkRatio * 1200;
    }

    if (hasNoiseMarker(element)) {
      score -= 1200;
    }

    if (formCount > paragraphCount + 4) {
      score -= 600;
    }

    if (coverage > 0.85) {
      score -= 900;
    }

    if (widthRatio > 0.96) {
      score -= 250;
    }

    if (widthRatio < 0.25) {
      score -= 450;
    }

    return score;
  }

  function addCandidate(candidates, element, boost) {
    if (!element || element === document.body || element === document.documentElement) {
      return;
    }

    candidates.set(element, Math.max(candidates.get(element) || 0, boost));
  }

  function getCandidateElements() {
    const candidates = new Map();
    const semanticSelectors = [
      { selector: "article", boost: 2600 },
      { selector: "main", boost: 2400 },
      { selector: "[role='main']", boost: 2400 },
      { selector: ".article", boost: 2100 },
      { selector: ".post", boost: 1800 },
      { selector: ".post-content", boost: 2200 },
      { selector: ".entry-content", boost: 2200 },
      { selector: ".main-content", boost: 1800 },
      { selector: ".markdown-body", boost: 2200 },
      { selector: "#article", boost: 2200 },
      { selector: "#main", boost: 1800 },
      { selector: "#content", boost: 1200 },
      { selector: ".content", boost: 900 }
    ];

    for (const { selector, boost } of semanticSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        addCandidate(candidates, element, boost);
      }
    }

    for (const node of document.querySelectorAll("p, h1, h2, h3, blockquote, pre, table")) {
      let element = node.parentElement;
      let depth = 0;

      while (element && element !== document.body && depth < 5) {
        addCandidate(candidates, element, 0);
        element = element.parentElement;
        depth += 1;
      }
    }

    return candidates;
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) {
      return `${tag}#${element.id}`;
    }

    const firstClass = getClassName(element).trim().split(/\s+/).filter(Boolean)[0];
    return firstClass ? `${tag}.${firstClass}` : tag;
  }

  function detectContentRegion(metrics) {
    const candidates = getCandidateElements();
    let bestElement = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const [element, boost] of candidates.entries()) {
      const score = scoreContentElement(element, metrics, boost);
      if (score > bestScore) {
        bestScore = score;
        bestElement = element;
      }
    }

    if (!bestElement) {
      bestElement = document.querySelector("article, main, [role='main']") || document.body || document.documentElement;
    }

    if (bestElement === document.body || bestElement === document.documentElement) {
      return {
        left: 0,
        top: 0,
        width: metrics.totalWidth,
        height: metrics.totalHeight,
        targetLabel: "整页"
      };
    }

    const rect = getDocumentRect(bestElement);
    const padding = Math.min(24, Math.max(8, metrics.viewportWidth * 0.02));
    const left = Math.floor(clampNumber(rect.left - padding, 0, Math.max(0, metrics.totalWidth - 1)));
    const top = Math.floor(clampNumber(rect.top - padding, 0, Math.max(0, metrics.totalHeight - 1)));
    const right = Math.ceil(clampNumber(rect.right + padding, left + 1, metrics.totalWidth));
    const bottom = Math.ceil(clampNumber(rect.bottom + padding, top + 1, metrics.totalHeight));

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      targetLabel: describeElement(bestElement)
    };
  }

  function ensureCaptureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html, body {
        scroll-behavior: auto !important;
        scrollbar-width: none !important;
      }
      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      *::-webkit-scrollbar {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function removeCaptureStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }

  function getFloatingElements() {
    return Array.from(document.querySelectorAll("body *")).filter((element) => {
      const style = getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function setFloatingElementsHidden(hidden) {
    if (hidden === state.floatingHidden) {
      return;
    }

    if (hidden) {
      state.hiddenFloatingElements = getFloatingElements().map((element) => ({
        element,
        visibility: element.style.visibility
      }));

      for (const item of state.hiddenFloatingElements) {
        item.element.style.visibility = "hidden";
      }

      state.floatingHidden = true;
      return;
    }

    for (const item of state.hiddenFloatingElements) {
      item.element.style.visibility = item.visibility;
    }

    state.hiddenFloatingElements = [];
    state.floatingHidden = false;
  }

  async function prepareCapture(captureMode = "full") {
    const body = getBody();
    state.originalX = window.scrollX;
    state.originalY = window.scrollY;
    state.originalDocumentScrollBehavior = document.documentElement.style.scrollBehavior;
    state.originalBodyScrollBehavior = body.style.scrollBehavior;

    document.documentElement.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    ensureCaptureStyle();
    state.prepared = true;

    await nextFrame();
    await delay(80);

    const metrics = getMetrics();
    const captureRegion = captureMode === "content"
      ? detectContentRegion(metrics)
      : {
        left: 0,
        top: 0,
        width: metrics.totalWidth,
        height: metrics.totalHeight,
        targetLabel: "整页"
      };

    return {
      ...metrics,
      captureMode,
      captureRegion,
      captureTargetLabel: captureRegion.targetLabel
    };
  }

  async function scrollForCapture(x, y, hideFloating) {
    if (!state.prepared) {
      await prepareCapture();
    }

    setFloatingElementsHidden(Boolean(hideFloating));
    window.scrollTo(x, y);

    await nextFrame();
    await nextFrame();
    await delay(120);

    return getMetrics();
  }

  async function cleanupCapture() {
    if (!state.prepared) {
      return getMetrics();
    }

    setFloatingElementsHidden(false);
    removeCaptureStyle();
    document.documentElement.style.scrollBehavior = state.originalDocumentScrollBehavior;
    getBody().style.scrollBehavior = state.originalBodyScrollBehavior;
    window.scrollTo(state.originalX, state.originalY);

    await nextFrame();
    state.prepared = false;

    return getMetrics();
  }

  function removeSelectionOverlay() {
    document.getElementById("__tokscr_selection_overlay__")?.remove();
  }

  async function sendSelectionResult(jobId, selection) {
    await nextFrame();
    await nextFrame();
    chrome.runtime.sendMessage({
      type: "TOKSCR_SELECTION_COMPLETE",
      jobId,
      selection
    });
  }

  function startSelection(jobId) {
    removeSelectionOverlay();

    const overlay = document.createElement("div");
    overlay.id = "__tokscr_selection_overlay__";
    overlay.innerHTML = `
      <div class="tokscr-selection-help">拖拽选择截图区域 · Esc 取消</div>
      <div class="tokscr-selection-box"></div>
      <style>
        #__tokscr_selection_overlay__ {
          position: fixed !important;
          inset: 0 !important;
          z-index: 2147483647 !important;
          cursor: crosshair !important;
          background: rgba(15, 23, 42, 0.16) !important;
          user-select: none !important;
        }
        #__tokscr_selection_overlay__ .tokscr-selection-help {
          position: fixed !important;
          top: 18px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          border: 1px solid rgba(238, 231, 218, 0.9) !important;
          border-radius: 999px !important;
          background: rgba(30, 47, 68, 0.94) !important;
          color: #fff8ed !important;
          padding: 8px 14px !important;
          font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.26) !important;
        }
        #__tokscr_selection_overlay__ .tokscr-selection-box {
          position: fixed !important;
          display: none;
          border: 2px solid #f0b35a !important;
          background: rgba(255, 248, 237, 0.18) !important;
          box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.42) !important;
        }
      </style>
    `;

    document.documentElement.appendChild(overlay);

    const box = overlay.querySelector(".tokscr-selection-box");
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let keydownHandler = null;

    function setBox(rect) {
      box.style.display = "block";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    }

    function getRect(event) {
      const left = Math.min(startX, event.clientX);
      const top = Math.min(startY, event.clientY);
      const right = Math.max(startX, event.clientX);
      const bottom = Math.max(startY, event.clientY);

      return {
        left: Math.max(0, left),
        top: Math.max(0, top),
        width: Math.max(1, Math.min(window.innerWidth, right) - Math.max(0, left)),
        height: Math.max(1, Math.min(window.innerHeight, bottom) - Math.max(0, top)),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      };
    }

    function cancel() {
      if (keydownHandler) {
        window.removeEventListener("keydown", keydownHandler, true);
      }
      removeSelectionOverlay();
      chrome.runtime.sendMessage({
        type: "TOKSCR_SELECTION_CANCELLED",
        jobId
      });
    }

    overlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      overlay.setPointerCapture(event.pointerId);
      setBox(getRect(event));
    });

    overlay.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }

      setBox(getRect(event));
    });

    overlay.addEventListener("pointerup", (event) => {
      if (!dragging) {
        return;
      }

      dragging = false;
      const selection = getRect(event);
      if (keydownHandler) {
        window.removeEventListener("keydown", keydownHandler, true);
      }
      removeSelectionOverlay();

      if (selection.width < 8 || selection.height < 8) {
        cancel();
        return;
      }

      sendSelectionResult(jobId, selection);
    });

    overlay.addEventListener("pointercancel", cancel);

    keydownHandler = (event) => {
      if (event.key === "Escape") {
        cancel();
      }
    };
    window.addEventListener("keydown", keydownHandler, true);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "FULL_PAGE_SCREENSHOT_PREPARE") {
      prepareCapture(message.captureMode || "full").then(sendResponse).catch((error) => {
        sendResponse({ error: error.message || String(error) });
      });
      return true;
    }

    if (message.type === "FULL_PAGE_SCREENSHOT_SCROLL") {
      scrollForCapture(message.x || 0, message.y || 0, message.hideFloating).then(sendResponse).catch((error) => {
        sendResponse({ error: error.message || String(error) });
      });
      return true;
    }

    if (message.type === "FULL_PAGE_SCREENSHOT_CLEANUP") {
      cleanupCapture().then(sendResponse).catch((error) => {
        sendResponse({ error: error.message || String(error) });
      });
      return true;
    }

    if (message.type === "TOKSCR_START_SELECTION") {
      startSelection(message.jobId);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
