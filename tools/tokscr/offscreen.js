const stitchJobs = new Map();

const MAX_CANVAS_DIMENSION = 32767;
const MAX_CANVAS_PIXELS = 160000000;

function createId() {
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("截图图片读取失败"));
    image.src = dataUrl;
  });
}

function getOutputScale(totalWidth, totalHeight, captureScale) {
  const maxByWidth = MAX_CANVAS_DIMENSION / totalWidth;
  const maxByHeight = MAX_CANVAS_DIMENSION / totalHeight;
  const maxByPixels = Math.sqrt(MAX_CANVAS_PIXELS / (totalWidth * totalHeight));
  const outputScale = Math.min(captureScale, maxByWidth, maxByHeight, maxByPixels);

  if (!Number.isFinite(outputScale) || outputScale <= 0) {
    throw new Error("页面尺寸过大，无法生成截图");
  }

  return outputScale;
}

function createCanvas(totalWidth, totalHeight, outputScale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(totalWidth * outputScale));
  canvas.height = Math.max(1, Math.floor(totalHeight * outputScale));

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("浏览器无法创建截图画布");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  return { canvas, context };
}

function drawTile(context, image, scrollInfo, captureRegion, captureScaleX, captureScaleY, outputScale) {
  const viewportLeft = scrollInfo.scrollX;
  const viewportTop = scrollInfo.scrollY;
  const viewportRight = viewportLeft + scrollInfo.viewportWidth;
  const viewportBottom = viewportTop + scrollInfo.viewportHeight;
  const regionRight = captureRegion.left + captureRegion.width;
  const regionBottom = captureRegion.top + captureRegion.height;
  const visibleLeft = Math.max(captureRegion.left, viewportLeft);
  const visibleTop = Math.max(captureRegion.top, viewportTop);
  const visibleRight = Math.min(regionRight, viewportRight);
  const visibleBottom = Math.min(regionBottom, viewportBottom);
  const cssWidth = Math.max(0, visibleRight - visibleLeft);
  const cssHeight = Math.max(0, visibleBottom - visibleTop);

  if (!cssWidth || !cssHeight) {
    return;
  }

  context.drawImage(
    image,
    Math.round((visibleLeft - viewportLeft) * captureScaleX),
    Math.round((visibleTop - viewportTop) * captureScaleY),
    Math.round(cssWidth * captureScaleX),
    Math.round(cssHeight * captureScaleY),
    Math.round((visibleLeft - captureRegion.left) * outputScale),
    Math.round((visibleTop - captureRegion.top) * outputScale),
    Math.round(cssWidth * outputScale),
    Math.round(cssHeight * outputScale)
  );
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("图片导出失败"));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function sanitizeRegion(region) {
  return {
    left: Math.max(0, Number(region.left) || 0),
    top: Math.max(0, Number(region.top) || 0),
    width: Math.max(1, Number(region.width) || 1),
    height: Math.max(1, Number(region.height) || 1)
  };
}

async function beginStitch(message) {
  const captureRegion = sanitizeRegion(message.captureRegion);
  stitchJobs.set(message.jobId, {
    title: message.title || "webpage",
    url: message.url || "",
    mode: message.mode || "full",
    captureRegion,
    canvas: null,
    context: null,
    outputScale: null
  });

  return { ok: true };
}

async function drawStitchTile(message) {
  const job = stitchJobs.get(message.jobId);
  if (!job) {
    throw new Error("截图任务不存在");
  }

  const image = await loadImage(message.dataUrl);
  const scrollInfo = message.scrollInfo;
  const captureScaleX = image.naturalWidth / scrollInfo.viewportWidth;
  const captureScaleY = image.naturalHeight / scrollInfo.viewportHeight;
  const captureScale = Math.min(captureScaleX, captureScaleY);

  if (!job.canvas) {
    job.outputScale = getOutputScale(job.captureRegion.width, job.captureRegion.height, captureScale);
    const canvasData = createCanvas(job.captureRegion.width, job.captureRegion.height, job.outputScale);
    job.canvas = canvasData.canvas;
    job.context = canvasData.context;
  }

  drawTile(job.context, image, scrollInfo, job.captureRegion, captureScaleX, captureScaleY, job.outputScale);

  return {
    ok: true,
    width: job.canvas.width,
    height: job.canvas.height
  };
}

async function finalizeStitch(message) {
  const job = stitchJobs.get(message.jobId);
  if (!job || !job.canvas) {
    throw new Error("截图任务没有生成图片");
  }

  const blob = await canvasToBlob(job.canvas, "image/png");
  const id = createId();

  await CaptureStore.put({
    id,
    title: job.title,
    url: job.url,
    mode: job.mode,
    width: job.canvas.width,
    height: job.canvas.height,
    blob,
    mimeType: "image/png",
    createdAt: Date.now()
  });

  stitchJobs.delete(message.jobId);

  return {
    ok: true,
    id,
    width: job.canvas.width,
    height: job.canvas.height
  };
}

async function createFromVisible(message) {
  const image = await loadImage(message.dataUrl);
  let crop = message.crop ? sanitizeRegion(message.crop) : {
    left: 0,
    top: 0,
    width: image.naturalWidth,
    height: image.naturalHeight
  };

  if (message.cropCss) {
    const cssCrop = {
      ...sanitizeRegion(message.cropCss),
      viewportWidth: Math.max(1, Number(message.cropCss.viewportWidth) || 1),
      viewportHeight: Math.max(1, Number(message.cropCss.viewportHeight) || 1)
    };
    const scaleX = image.naturalWidth / cssCrop.viewportWidth;
    const scaleY = image.naturalHeight / cssCrop.viewportHeight;
    crop = {
      left: cssCrop.left * scaleX,
      top: cssCrop.top * scaleY,
      width: cssCrop.width * scaleX,
      height: cssCrop.height * scaleY
    };
  }

  crop.left = Math.max(0, Math.min(crop.left, image.naturalWidth - 1));
  crop.top = Math.max(0, Math.min(crop.top, image.naturalHeight - 1));
  crop.width = Math.max(1, Math.min(crop.width, image.naturalWidth - crop.left));
  crop.height = Math.max(1, Math.min(crop.height, image.naturalHeight - crop.top));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("浏览器无法创建截图画布");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    Math.round(crop.left),
    Math.round(crop.top),
    Math.round(crop.width),
    Math.round(crop.height),
    0,
    0,
    canvas.width,
    canvas.height
  );

  const blob = await canvasToBlob(canvas, "image/png");
  const id = createId();

  await CaptureStore.put({
    id,
    title: message.title || "webpage",
    url: message.url || "",
    mode: message.mode || "visible",
    width: canvas.width,
    height: canvas.height,
    blob,
    mimeType: "image/png",
    createdAt: Date.now()
  });

  return {
    ok: true,
    id,
    width: canvas.width,
    height: canvas.height
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") {
    return false;
  }

  const run = async () => {
    if (message.type === "BEGIN_STITCH") {
      return await beginStitch(message);
    }

    if (message.type === "DRAW_STITCH_TILE") {
      return await drawStitchTile(message);
    }

    if (message.type === "FINALIZE_STITCH") {
      return await finalizeStitch(message);
    }

    if (message.type === "CREATE_FROM_VISIBLE") {
      return await createFromVisible(message);
    }

    throw new Error(`未知的 offscreen 消息：${message.type}`);
  };

  run().then((result) => sendResponse(result)).catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});
