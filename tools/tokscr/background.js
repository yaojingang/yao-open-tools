const jobs = new Map();
let creatingOffscreen = null;

const MIN_CAPTURE_INTERVAL_MS = 550;
let lastCaptureStartedAt = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createJob(mode) {
  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    mode,
    state: "running",
    message: "准备截图",
    progress: 0,
    resultId: null,
    error: null,
    createdAt: Date.now()
  };
  jobs.set(job.id, job);
  return job;
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }

  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];

  if (!tab || typeof tab.id !== "number") {
    throw new Error("没有找到当前活动标签页");
  }

  return tab;
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function sendTabMessage(tabId, message) {
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (response && response.error) {
    throw new Error(response.error);
  }
  return response;
}

async function ensureOffscreen() {
  if (creatingOffscreen) {
    return creatingOffscreen;
  }

  const offscreenUrl = chrome.runtime.getURL("offscreen.html");

  if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) {
    return;
  }

  if (self.clients) {
    const clients = await self.clients.matchAll();
    if (clients.some((client) => client.url === offscreenUrl)) {
      return;
    }
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS", "CLIPBOARD"],
    justification: "Compose screenshots, store blobs, and support clipboard export."
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function sendOffscreen(message) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ ...message, target: "offscreen" });

  if (response && response.ok === false) {
    throw new Error(response.error || "Offscreen 操作失败");
  }

  return response;
}

async function captureVisibleTab(windowId) {
  const elapsed = Date.now() - lastCaptureStartedAt;
  if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
    await delay(MIN_CAPTURE_INTERVAL_MS - elapsed);
  }

  lastCaptureStartedAt = Date.now();

  return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildScrollPositionsForRegion(regionStart, regionSize, viewportSize, totalSize) {
  const safeRegionStart = Math.max(0, Math.floor(regionStart));
  const safeRegionSize = Math.max(1, Math.ceil(regionSize));
  const safeViewportSize = Math.max(1, Math.ceil(viewportSize));
  const safeTotalSize = Math.max(safeViewportSize, Math.ceil(totalSize));
  const maxScroll = Math.max(0, safeTotalSize - safeViewportSize);
  const regionEnd = safeRegionStart + safeRegionSize;

  if (safeRegionSize <= safeViewportSize) {
    return [clamp(safeRegionStart, 0, maxScroll)];
  }

  const positions = [];
  const lastPosition = clamp(regionEnd - safeViewportSize, 0, maxScroll);
  let position = safeRegionStart;

  while (position < regionEnd) {
    const nextPosition = clamp(Math.min(position, regionEnd - safeViewportSize), 0, maxScroll);
    positions.push(nextPosition);

    if (nextPosition >= lastPosition) {
      break;
    }

    position += safeViewportSize;
  }

  return [...new Set(positions)];
}

async function openResult(resultId) {
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`result.html?id=${encodeURIComponent(resultId)}`)
  });
}

async function captureVisible(job, tab) {
  updateJob(job.id, { message: "捕捉可见区域", progress: 20 });
  const dataUrl = await captureVisibleTab(tab.windowId);

  updateJob(job.id, { message: "生成预览", progress: 70 });
  const result = await sendOffscreen({
    type: "CREATE_FROM_VISIBLE",
    jobId: job.id,
    dataUrl,
    title: tab.title || "webpage",
    url: tab.url || "",
    mode: "visible"
  });

  updateJob(job.id, {
    state: "complete",
    message: "已打开预览页",
    progress: 100,
    resultId: result.id
  });
  await openResult(result.id);
}

async function captureFullOrContent(job, tab, mode) {
  updateJob(job.id, { message: mode === "content" ? "识别主体内容" : "读取页面尺寸", progress: 5 });

  await injectContentScript(tab.id);
  const pageMetrics = await sendTabMessage(tab.id, {
    type: "FULL_PAGE_SCREENSHOT_PREPARE",
    captureMode: mode
  });

  const captureRegion = pageMetrics.captureRegion || {
    left: 0,
    top: 0,
    width: pageMetrics.totalWidth,
    height: pageMetrics.totalHeight
  };
  const xPositions = buildScrollPositionsForRegion(
    captureRegion.left,
    captureRegion.width,
    pageMetrics.viewportWidth,
    pageMetrics.totalWidth
  );
  const yPositions = buildScrollPositionsForRegion(
    captureRegion.top,
    captureRegion.height,
    pageMetrics.viewportHeight,
    pageMetrics.totalHeight
  );
  const totalTiles = xPositions.length * yPositions.length;

  await sendOffscreen({
    type: "BEGIN_STITCH",
    jobId: job.id,
    title: pageMetrics.title || tab.title || "webpage",
    url: pageMetrics.url || tab.url || "",
    mode,
    captureRegion
  });

  let completedTiles = 0;

  try {
    for (const y of yPositions) {
      for (const x of xPositions) {
        const isFirstTile = completedTiles === 0;
        const scrollInfo = await sendTabMessage(tab.id, {
          type: "FULL_PAGE_SCREENSHOT_SCROLL",
          x,
          y,
          hideFloating: mode === "content" || !isFirstTile
        });

        const dataUrl = await captureVisibleTab(tab.windowId);
        await sendOffscreen({
          type: "DRAW_STITCH_TILE",
          jobId: job.id,
          dataUrl,
          scrollInfo
        });

        completedTiles += 1;
        updateJob(job.id, {
          message: `拼接截图 ${completedTiles}/${totalTiles}`,
          progress: Math.round((completedTiles / totalTiles) * 88)
        });
      }
    }

    updateJob(job.id, { message: "生成预览", progress: 94 });
    const result = await sendOffscreen({
      type: "FINALIZE_STITCH",
      jobId: job.id
    });

    updateJob(job.id, {
      state: "complete",
      message: "已打开预览页",
      progress: 100,
      resultId: result.id
    });
    await openResult(result.id);
  } finally {
    try {
      await sendTabMessage(tab.id, { type: "FULL_PAGE_SCREENSHOT_CLEANUP" });
    } catch (_error) {
      // The source tab may have navigated or closed before cleanup.
    }
  }
}

async function startSelection(job, tab) {
  updateJob(job.id, { message: "在页面中拖拽选择区域", progress: 10 });
  await injectContentScript(tab.id);
  await sendTabMessage(tab.id, {
    type: "TOKSCR_START_SELECTION",
    jobId: job.id
  });
}

async function runCapture(jobId, mode) {
  const job = getJob(jobId);

  try {
    const tab = await getActiveTab();

    if (mode === "visible") {
      await captureVisible(job, tab);
      return;
    }

    if (mode === "selection") {
      await startSelection(job, tab);
      return;
    }

    await captureFullOrContent(job, tab, mode);
  } catch (error) {
    updateJob(jobId, {
      state: "error",
      message: error.message || "截图失败",
      error: error.message || String(error),
      progress: 0
    });
  }
}

async function finishSelection(message, sender) {
  const tab = sender.tab;
  const job = getJob(message.jobId);

  if (!tab || !job || !message.selection) {
    return;
  }

  try {
    updateJob(job.id, { message: "捕捉选择区域", progress: 45 });
    const dataUrl = await captureVisibleTab(tab.windowId);

    const result = await sendOffscreen({
      type: "CREATE_FROM_VISIBLE",
      jobId: job.id,
      dataUrl,
      cropCss: message.selection,
      title: tab.title || "webpage",
      url: tab.url || "",
      mode: "selection"
    });

    updateJob(job.id, {
      state: "complete",
      message: "已打开预览页",
      progress: 100,
      resultId: result.id
    });
    await openResult(result.id);
  } catch (error) {
    updateJob(job.id, {
      state: "error",
      message: error.message || "选择区域截图失败",
      error: error.message || String(error),
      progress: 0
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    if (message.type === "START_CAPTURE") {
      const job = createJob(message.mode || "full");
      runCapture(job.id, job.mode);
      return { ok: true, job };
    }

    if (message.type === "GET_JOB_STATUS") {
      return { ok: true, job: getJob(message.jobId) };
    }

    if (message.type === "TOKSCR_SELECTION_COMPLETE") {
      await finishSelection(message, sender);
      return { ok: true };
    }

    if (message.type === "TOKSCR_SELECTION_CANCELLED") {
      updateJob(message.jobId, {
        state: "cancelled",
        message: "已取消选择区域",
        progress: 0
      });
      return { ok: true };
    }

    return null;
  };

  run().then((response) => {
    if (response) {
      sendResponse(response);
    }
  }).catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});
