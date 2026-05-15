const previewImage = document.getElementById("previewImage");
const editorToolbar = document.getElementById("editorToolbar");
const editorCanvas = document.getElementById("editorCanvas");
const inlineTextEditor = document.getElementById("inlineTextEditor");
const cropToolbar = document.getElementById("cropToolbar");
const cropOverlay = document.getElementById("cropOverlay");
const cropBox = document.getElementById("cropBox");
const cropApply = document.getElementById("cropApply");
const cropCancel = document.getElementById("cropCancel");
const editorApply = document.getElementById("editorApply");
const editorCancel = document.getElementById("editorCancel");
const editorUndo = document.getElementById("editorUndo");
const editorRedo = document.getElementById("editorRedo");
const editorDelete = document.getElementById("editorDelete");
const captureTitle = document.getElementById("captureTitle");
const captureUrl = document.getElementById("captureUrl");
const captureMode = document.getElementById("captureMode");
const captureSize = document.getElementById("captureSize");
const captureTime = document.getElementById("captureTime");
const statusText = document.getElementById("statusText");
const actionButtons = Array.from(document.querySelectorAll("[data-action]"));
const editorToolButtons = Array.from(document.querySelectorAll("[data-editor-tool]"));
const editorColorButtons = Array.from(document.querySelectorAll("[data-editor-color]"));
const editorWidthButtons = Array.from(document.querySelectorAll("[data-editor-width]"));
const editorSizeButtons = Array.from(document.querySelectorAll("[data-editor-size]"));
const {
  clampCropRect,
  createInitialCropRect,
  selectionToNaturalRect
} = window.TokscrCropUtils;
const {
  annotationBounds,
  createTextAnnotation,
  getEditorCropTransition,
  hitTestAnnotations,
  mapDisplayToNaturalPoint,
  normalizeEditorRect,
  resizeTextAnnotation
} = window.TokscrEditorUtils;

const MODE_LABELS = {
  full: "完整页面",
  visible: "可见区域",
  selection: "选择区域",
  content: "主体去噪"
};
const MIN_CROP_SIZE = 32;

let record = null;
let objectUrl = null;
let isBusy = false;
let cropState = {
  active: false,
  rect: null,
  interaction: null
};
let editorState = {
  active: false,
  tool: "select",
  color: "#d93025",
  lineWidth: 6,
  fontSize: 32,
  annotations: [],
  selectedId: null,
  draft: null,
  interaction: null,
  undoStack: [],
  redoStack: []
};
let inlineTextState = {
  active: false,
  point: null
};

function setStatus(message) {
  statusText.textContent = message;
}

function updateButtonStates() {
  for (const button of actionButtons) {
    const action = button.dataset.action;
    button.disabled = isBusy
      || (cropState.active && action !== "crop")
      || (editorState.active && action !== "edit");
    button.classList.toggle("is-active", action === "crop" && cropState.active);
    button.classList.toggle("is-active", action === "edit" && editorState.active);
  }

  cropApply.disabled = isBusy;
  cropCancel.disabled = isBusy;
  editorApply.disabled = isBusy;
  editorCancel.disabled = isBusy;
  editorUndo.disabled = isBusy || !editorState.undoStack.length;
  editorRedo.disabled = isBusy || !editorState.redoStack.length;
  editorDelete.disabled = isBusy || !editorState.selectedId;
}

function setBusy(busy) {
  isBusy = busy;
  updateButtonStates();
}

function getModeLabel() {
  const label = MODE_LABELS[record?.mode] || record?.mode || "-";
  const flags = [];

  if (record?.cropped) {
    flags.push("已裁剪");
  }

  if (record?.edited) {
    flags.push("已编辑");
  }

  return flags.length ? `${label}（${flags.join("，")}）` : label;
}

function renderMetadata() {
  captureTitle.textContent = record.title || "webpage";
  captureUrl.textContent = record.url || "";
  captureMode.textContent = getModeLabel();
  captureSize.textContent = `${record.width} × ${record.height}`;
  captureTime.textContent = new Date(record.createdAt).toLocaleString();
}

function refreshPreviewImage() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }

  objectUrl = URL.createObjectURL(record.blob);
  previewImage.src = objectUrl;
}

async function ensurePreviewReady() {
  if (previewImage.complete && previewImage.naturalWidth > 0) {
    return;
  }

  if (previewImage.decode) {
    await previewImage.decode().catch(() => {});
  }

  if (!previewImage.naturalWidth || !previewImage.naturalHeight) {
    throw new Error("截图预览尚未加载完成");
  }
}

function sanitizeFilename(name) {
  const cleaned = (name || "webpage")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 90) || "webpage";
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function getBaseFilename(extension) {
  const title = sanitizeFilename(record?.title || "webpage");
  const mode = getModeLabel() || "截图";
  return `${title}-${mode}-${formatTimestamp(new Date(record?.createdAt || Date.now()))}.${extension}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
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

async function convertToJpegBlob() {
  const image = await loadImageFromBlob(record.blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("浏览器无法创建图片画布");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  return await canvasToBlob(canvas, "image/jpeg", 0.92);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",", 2)[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function concatBytes(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function createPdfFromSegments(segments, pageWidth, pageHeight, margin) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;

  function appendText(text) {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    length += bytes.length;
  }

  function appendBytes(bytes) {
    chunks.push(bytes);
    length += bytes.length;
  }

  function beginObject(number) {
    offsets[number] = length;
    appendText(`${number} 0 obj\n`);
  }

  appendText("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  beginObject(1);
  appendText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids = segments.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  beginObject(2);
  appendText(`<< /Type /Pages /Count ${segments.length} /Kids [ ${kids} ] >>\nendobj\n`);

  segments.forEach((segment, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const imageName = `Im${index + 1}`;
    const drawWidth = pageWidth - margin * 2;
    const drawHeight = segment.drawHeight;
    const drawX = margin;
    const drawY = pageHeight - margin - drawHeight;
    const content = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/${imageName} Do\nQ\n`;
    const contentBytes = encoder.encode(content);

    beginObject(pageObject);
    appendText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`);

    beginObject(imageObject);
    appendText(`<< /Type /XObject /Subtype /Image /Width ${segment.width} /Height ${segment.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${segment.bytes.length} >>\nstream\n`);
    appendBytes(segment.bytes);
    appendText("\nendstream\nendobj\n");

    beginObject(contentObject);
    appendText(`<< /Length ${contentBytes.length} >>\nstream\n`);
    appendBytes(contentBytes);
    appendText("endstream\nendobj\n");
  });

  const xrefOffset = length;
  const objectCount = 2 + segments.length * 3;
  appendText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);

  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    appendText(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`);
  }

  appendText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}

async function createPdfBlob() {
  const image = await loadImageFromBlob(record.blob);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const sourcePageHeight = Math.max(1, Math.floor(image.naturalWidth * (contentHeight / contentWidth)));
  const renderWidth = Math.min(image.naturalWidth, 2400);
  const renderScale = renderWidth / image.naturalWidth;
  const segments = [];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("浏览器无法创建 PDF 画布");
  }

  canvas.width = renderWidth;

  for (let sourceY = 0; sourceY < image.naturalHeight; sourceY += sourcePageHeight) {
    const sourceHeight = Math.min(sourcePageHeight, image.naturalHeight - sourceY);
    const renderHeight = Math.max(1, Math.round(sourceHeight * renderScale));
    canvas.height = renderHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      0,
      sourceY,
      image.naturalWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    segments.push({
      bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)),
      width: canvas.width,
      height: canvas.height,
      drawHeight: Math.min(contentHeight, (sourceHeight / image.naturalWidth) * contentWidth)
    });
  }

  return createPdfFromSegments(segments, pageWidth, pageHeight, margin);
}

async function copyToClipboard() {
  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error("当前浏览器不支持图片剪贴板写入");
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": record.blob
    })
  ]);
}

function cloneAnnotations(annotations) {
  return JSON.parse(JSON.stringify(annotations));
}

function getAnnotationById(id) {
  return editorState.annotations.find((annotation) => annotation.id === id) || null;
}

function createAnnotationId() {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getEditorDimensions() {
  const displaySize = getPreviewDisplaySize();

  return {
    displayWidth: displaySize.width,
    displayHeight: displaySize.height,
    naturalWidth: Math.max(1, previewImage.naturalWidth || record?.width || 1),
    naturalHeight: Math.max(1, previewImage.naturalHeight || record?.height || 1)
  };
}

function naturalPointToDisplay(point) {
  const dimensions = getEditorDimensions();

  return {
    x: point.x * (dimensions.displayWidth / dimensions.naturalWidth),
    y: point.y * (dimensions.displayHeight / dimensions.naturalHeight)
  };
}

function naturalRectToDisplay(rect) {
  const origin = naturalPointToDisplay({ x: rect.x, y: rect.y });
  const far = naturalPointToDisplay({ x: rect.x + rect.width, y: rect.y + rect.height });

  return {
    x: origin.x,
    y: origin.y,
    width: far.x - origin.x,
    height: far.y - origin.y
  };
}

function getEditorPoint(event) {
  const bounds = editorCanvas.getBoundingClientRect();

  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  };
}

function displayPointToNatural(point) {
  return mapDisplayToNaturalPoint(point, getEditorDimensions());
}

function syncEditorCanvasSize() {
  if (!editorState.active) {
    return;
  }

  const dimensions = getEditorDimensions();
  const ratio = window.devicePixelRatio || 1;
  editorCanvas.style.width = `${dimensions.displayWidth}px`;
  editorCanvas.style.height = `${dimensions.displayHeight}px`;
  editorCanvas.width = Math.max(1, Math.round(dimensions.displayWidth * ratio));
  editorCanvas.height = Math.max(1, Math.round(dimensions.displayHeight * ratio));
  positionInlineTextEditor();
  renderEditorCanvas();
}

function pushEditorHistory() {
  editorState.undoStack.push(cloneAnnotations(editorState.annotations));

  if (editorState.undoStack.length > 40) {
    editorState.undoStack.shift();
  }

  editorState.redoStack = [];
  updateButtonStates();
}

async function switchEditorToCropMode() {
  const transition = getEditorCropTransition({
    annotationCount: editorState.annotations.length
  });

  if (transition === "apply-then-crop") {
    setStatus("正在应用当前编辑并准备裁剪");
    const applied = await applyEditor({
      successMessage: "编辑已应用，正在准备裁剪"
    });

    if (applied) {
      await enterCropMode();
    }
    return;
  }

  exitEditorMode("已退出编辑，可继续裁剪");
  await enterCropMode();
}

async function setEditorTool(tool) {
  if (inlineTextState.active) {
    commitInlineTextEditor();
  }

  if (tool === "crop") {
    await switchEditorToCropMode();
    return;
  }

  editorState.tool = tool;
  editorCanvas.classList.toggle("is-selecting", tool === "select");
  editorCanvas.style.cursor = "";
  updateEditorControls();
  setStatus(getEditorToolStatus());
}

function getEditorToolStatus() {
  const labels = {
    select: "选择工具：点击标注可移动或删除",
    text: "文字工具：点击截图后直接输入，Enter 完成",
    arrow: "箭头工具：拖动生成箭头",
    rect: "矩形工具：拖动框选重点区域",
    brush: "画笔工具：按住拖动自由涂抹",
    mosaic: "马赛克工具：点击生成圆形马赛克，拖动生成椭圆马赛克",
    cover: "遮盖工具：拖动生成纯色遮挡块"
  };

  return labels[editorState.tool] || "编辑模式";
}

function updateEditorControls() {
  for (const button of editorToolButtons) {
    button.classList.toggle("is-active", button.dataset.editorTool === editorState.tool);
  }

  for (const button of editorColorButtons) {
    button.classList.toggle("is-active", button.dataset.editorColor === editorState.color);
  }

  for (const button of editorWidthButtons) {
    button.classList.toggle("is-active", Number(button.dataset.editorWidth) === editorState.lineWidth);
  }

  for (const button of editorSizeButtons) {
    button.classList.toggle("is-active", Number(button.dataset.editorSize) === editorState.fontSize);
  }

  updateButtonStates();
}

function updateInlineTextEditorSize() {
  if (!inlineTextState.active || !inlineTextState.point) {
    return;
  }

  const dimensions = getEditorDimensions();
  const displayPoint = naturalPointToDisplay(inlineTextState.point);
  const scale = dimensions.displayWidth / dimensions.naturalWidth;
  const fontSize = Math.max(12, editorState.fontSize * scale);
  const availableWidth = Math.max(140, dimensions.displayWidth - displayPoint.x - 12);
  const textLength = Math.max(4, inlineTextEditor.value.length || inlineTextEditor.placeholder.length || 4);
  const preferredWidth = Math.ceil(textLength * fontSize * 0.68 + 24);

  inlineTextEditor.style.width = `${Math.min(availableWidth, Math.max(140, preferredWidth))}px`;
  inlineTextEditor.style.height = `${Math.ceil(fontSize * 1.7)}px`;
}

function positionInlineTextEditor() {
  if (!inlineTextState.active || !inlineTextState.point) {
    return;
  }

  const dimensions = getEditorDimensions();
  const displayPoint = naturalPointToDisplay(inlineTextState.point);
  const scale = dimensions.displayWidth / dimensions.naturalWidth;
  const fontSize = Math.max(12, editorState.fontSize * scale);

  inlineTextEditor.style.left = `${displayPoint.x}px`;
  inlineTextEditor.style.top = `${displayPoint.y}px`;
  inlineTextEditor.style.fontSize = `${fontSize}px`;
  inlineTextEditor.style.setProperty("--inline-text-color", editorState.color);
  updateInlineTextEditorSize();
}

function beginInlineTextEditor(point) {
  if (inlineTextState.active) {
    commitInlineTextEditor();
  }

  inlineTextState = {
    active: true,
    point
  };
  inlineTextEditor.value = "";
  inlineTextEditor.placeholder = "输入文字";
  inlineTextEditor.hidden = false;
  positionInlineTextEditor();
  inlineTextEditor.focus();
  inlineTextEditor.select();
  setStatus("直接输入文字，按 Enter 完成，Esc 取消");
}

function cancelInlineTextEditor() {
  inlineTextState = {
    active: false,
    point: null
  };
  inlineTextEditor.value = "";
  inlineTextEditor.hidden = true;
}

function commitInlineTextEditor() {
  if (!inlineTextState.active || !inlineTextState.point) {
    return;
  }

  const text = inlineTextEditor.value.trim();
  const point = inlineTextState.point;
  cancelInlineTextEditor();

  if (!text) {
    setStatus(getEditorToolStatus());
    return;
  }

  pushEditorHistory();
  const annotation = createTextAnnotation({
    id: createAnnotationId(),
    text,
    point,
    color: editorState.color,
    fontSize: editorState.fontSize
  });
  editorState.annotations.push(annotation);
  editorState.selectedId = annotation.id;
  editorState.tool = "select";
  editorCanvas.classList.add("is-selecting");
  updateEditorControls();
  renderEditorCanvas();
  setStatus("文字已添加，可拖动移动，也可拖边框调整字号");
}

function drawArrowHead(context, from, to, color, lineWidth) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = Math.max(12, lineWidth * 3.2);

  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  context.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function clampImageRect(rect, width, height) {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);

  return normalizeEditorRect({
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  });
}

function clipMosaicShape(context, annotation, scale) {
  context.beginPath();

  if (annotation.shape === "ellipse") {
    context.ellipse(
      annotation.cx * scale,
      annotation.cy * scale,
      Math.max(1, Math.abs(annotation.rx) * scale),
      Math.max(1, Math.abs(annotation.ry) * scale),
      0,
      0,
      Math.PI * 2
    );
    return;
  }

  const rect = normalizeEditorRect({
    x: annotation.x * scale,
    y: annotation.y * scale,
    width: annotation.width * scale,
    height: annotation.height * scale
  });
  context.rect(rect.x, rect.y, rect.width, rect.height);
}

function drawMosaicPixels(context, source, annotation, options = {}) {
  const sourceWidth = options.sourceWidth || source.naturalWidth || source.width;
  const sourceHeight = options.sourceHeight || source.naturalHeight || source.height;
  const scale = options.scale || 1;
  const sourceRect = clampImageRect(annotationBounds(annotation), sourceWidth, sourceHeight);

  if (sourceRect.width < 1 || sourceRect.height < 1) {
    return;
  }

  const displayRect = {
    x: sourceRect.x * scale,
    y: sourceRect.y * scale,
    width: sourceRect.width * scale,
    height: sourceRect.height * scale
  };
  const blockSize = Math.max(8, (annotation.blockSize || 18) * scale);
  const smallCanvas = document.createElement("canvas");
  const smallContext = smallCanvas.getContext("2d");

  if (!smallContext) {
    return;
  }

  smallCanvas.width = Math.max(1, Math.ceil(displayRect.width / blockSize));
  smallCanvas.height = Math.max(1, Math.ceil(displayRect.height / blockSize));
  smallContext.drawImage(
    source,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    smallCanvas.width,
    smallCanvas.height
  );

  context.save();
  clipMosaicShape(context, annotation, scale);
  context.clip();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    smallCanvas,
    0,
    0,
    smallCanvas.width,
    smallCanvas.height,
    displayRect.x,
    displayRect.y,
    displayRect.width,
    displayRect.height
  );
  context.restore();
}

function drawMosaicPreview(context, annotation, color, scale) {
  if (previewImage.naturalWidth) {
    drawMosaicPixels(context, previewImage, annotation, { scale });
  }

  context.save();
  clipMosaicShape(context, annotation, scale);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.setLineDash([7, 4]);
  context.stroke();
  context.restore();
}

function applyMosaic(context, annotation) {
  drawMosaicPixels(context, context.canvas, annotation, {
    scale: 1,
    sourceWidth: context.canvas.width,
    sourceHeight: context.canvas.height
  });
}

function drawAnnotation(context, annotation, options = {}) {
  const scale = options.scale || 1;
  const color = annotation.color || editorState.color;
  const lineWidth = Math.max(1, (annotation.lineWidth || editorState.lineWidth) * scale);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (annotation.type === "text") {
    context.fillStyle = color;
    context.font = `700 ${Math.max(10, annotation.fontSize * scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textBaseline = "alphabetic";
    context.fillText(annotation.text, annotation.x * scale, annotation.y * scale);
  }

  if (annotation.type === "arrow") {
    const from = { x: annotation.x1 * scale, y: annotation.y1 * scale };
    const to = { x: annotation.x2 * scale, y: annotation.y2 * scale };
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    drawArrowHead(context, from, to, color, lineWidth);
  }

  if (annotation.type === "rect") {
    const rect = normalizeEditorRect({
      x: annotation.x * scale,
      y: annotation.y * scale,
      width: annotation.width * scale,
      height: annotation.height * scale
    });
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  if (annotation.type === "brush") {
    const points = annotation.points || [];
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    points.forEach((point, index) => {
      const x = point.x * scale;
      const y = point.y * scale;

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
  }

  if (annotation.type === "mosaic") {
    if (options.final) {
      applyMosaic(context, annotation);
    } else {
      drawMosaicPreview(context, annotation, color, scale);
    }
  }

  if (annotation.type === "cover") {
    const rect = normalizeEditorRect({
      x: annotation.x * scale,
      y: annotation.y * scale,
      width: annotation.width * scale,
      height: annotation.height * scale
    });
    context.fillStyle = color;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  context.restore();
}

function drawSelectedAnnotation(context, annotation) {
  const bounds = naturalRectToDisplay(annotationBounds(annotation));
  const offset = annotation.type === "text" ? 3 : 4;

  context.save();
  context.setLineDash(annotation.type === "text" ? [3, 3] : [6, 4]);
  context.strokeStyle = "#1f6f68";
  context.globalAlpha = annotation.type === "text" ? 0.82 : 1;
  context.lineWidth = annotation.type === "text" ? 1 : 2;
  context.strokeRect(bounds.x - offset, bounds.y - offset, bounds.width + offset * 2, bounds.height + offset * 2);

  if (annotation.type === "text") {
    context.setLineDash([]);
    context.fillStyle = "#fffaf2";
    context.strokeStyle = "#1f6f68";
    context.lineWidth = 1.25;

    for (const handle of getTextResizeHandles(bounds)) {
      context.beginPath();
      context.rect(handle.x - 4, handle.y - 4, 8, 8);
      context.fill();
      context.stroke();
    }
  }

  context.restore();
}

function getTextResizeHandles(bounds) {
  const left = bounds.x - 3;
  const top = bounds.y - 3;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const right = bounds.x + bounds.width + 3;
  const bottom = bounds.y + bounds.height + 3;

  return [
    { handle: "nw", x: left, y: top },
    { handle: "n", x: centerX, y: top },
    { handle: "ne", x: right, y: top },
    { handle: "e", x: right, y: centerY },
    { handle: "se", x: right, y: bottom },
    { handle: "s", x: centerX, y: bottom },
    { handle: "sw", x: left, y: bottom },
    { handle: "w", x: left, y: centerY }
  ];
}

function renderEditorCanvas() {
  if (!editorState.active) {
    return;
  }

  const dimensions = getEditorDimensions();
  const ratio = window.devicePixelRatio || 1;
  const context = editorCanvas.getContext("2d");

  if (!context) {
    return;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, dimensions.displayWidth, dimensions.displayHeight);

  const scale = dimensions.displayWidth / dimensions.naturalWidth;
  for (const annotation of editorState.annotations) {
    drawAnnotation(context, annotation, { scale });
  }

  if (editorState.draft) {
    drawAnnotation(context, editorState.draft, { scale });
  }

  const selected = getAnnotationById(editorState.selectedId);
  if (selected) {
    drawSelectedAnnotation(context, selected);
  }
}

async function enterEditorMode() {
  if (!record || cropState.active) {
    setStatus("请先应用或取消裁剪");
    return;
  }

  setBusy(true);

  try {
    setStatus("正在准备编辑器");
    await ensurePreviewReady();
    editorState = {
      active: true,
      tool: "select",
      color: editorState.color || "#d93025",
      lineWidth: editorState.lineWidth || 6,
      fontSize: editorState.fontSize || 32,
      annotations: [],
      selectedId: null,
      draft: null,
      interaction: null,
      undoStack: [],
      redoStack: []
    };
    editorCanvas.hidden = false;
    editorToolbar.hidden = false;
    syncEditorCanvasSize();
    updateEditorControls();
    setStatus("编辑模式：选择工具后在截图上操作");
  } catch (error) {
    setStatus(error.message || "编辑器准备失败");
  } finally {
    setBusy(false);
  }
}

function exitEditorMode(message = "已取消编辑") {
  cancelInlineTextEditor();
  editorState.active = false;
  editorState.annotations = [];
  editorState.selectedId = null;
  editorState.draft = null;
  editorState.interaction = null;
  editorState.undoStack = [];
  editorState.redoStack = [];
  editorCanvas.hidden = true;
  editorToolbar.hidden = true;
  updateEditorControls();
  setStatus(message);
}

function getTextResizeHandleAtPoint(annotation, point) {
  if (annotation?.type !== "text") {
    return null;
  }

  const dimensions = getEditorDimensions();
  const scale = dimensions.displayWidth / dimensions.naturalWidth;
  const hitRadius = Math.max(8, 9 / Math.max(scale, 0.01));
  const bounds = annotationBounds(annotation);

  for (const item of getTextResizeHandles(bounds)) {
    if (Math.abs(point.x - item.x) <= hitRadius && Math.abs(point.y - item.y) <= hitRadius) {
      return item.handle;
    }
  }

  return null;
}

function getResizeCursor(handle) {
  const cursors = {
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize"
  };

  return cursors[handle] || "move";
}

function buildTextResizeRect(startBounds, handle, point) {
  let left = startBounds.x;
  let top = startBounds.y;
  let right = startBounds.x + startBounds.width;
  let bottom = startBounds.y + startBounds.height;
  const minSize = 10;

  if (handle.includes("w")) {
    left = point.x;
  }

  if (handle.includes("e")) {
    right = point.x;
  }

  if (handle.includes("n")) {
    top = point.y;
  }

  if (handle.includes("s")) {
    bottom = point.y;
  }

  if (right - left < minSize) {
    if (handle.includes("w")) {
      left = right - minSize;
    } else {
      right = left + minSize;
    }
  }

  if (bottom - top < minSize) {
    if (handle.includes("n")) {
      top = bottom - minSize;
    } else {
      bottom = top + minSize;
    }
  }

  return normalizeEditorRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  });
}

function updateEditorHoverCursor(event) {
  if (editorState.tool !== "select") {
    editorCanvas.style.cursor = "";
    return;
  }

  const point = displayPointToNatural(getEditorPoint(event));
  const selected = getAnnotationById(editorState.selectedId);
  const resizeHandle = getTextResizeHandleAtPoint(selected, point);

  if (resizeHandle) {
    editorCanvas.style.cursor = getResizeCursor(resizeHandle);
    return;
  }

  editorCanvas.style.cursor = hitTestAnnotations(editorState.annotations, point) ? "move" : "";
}

function moveAnnotation(annotation, dx, dy) {
  if (annotation.type === "arrow") {
    annotation.x1 += dx;
    annotation.y1 += dy;
    annotation.x2 += dx;
    annotation.y2 += dy;
    return;
  }

  if (annotation.type === "brush") {
    annotation.points = annotation.points.map((point) => ({
      x: point.x + dx,
      y: point.y + dy
    }));
    return;
  }

  if (annotation.type === "mosaic" && annotation.shape === "ellipse") {
    annotation.cx += dx;
    annotation.cy += dy;
    return;
  }

  annotation.x += dx;
  annotation.y += dy;
}

function createRectAnnotation(type, startPoint, endPoint) {
  const rect = normalizeEditorRect({
    x: startPoint.x,
    y: startPoint.y,
    width: endPoint.x - startPoint.x,
    height: endPoint.y - startPoint.y
  });

  return {
    id: createAnnotationId(),
    type,
    color: editorState.color,
    lineWidth: editorState.lineWidth,
    blockSize: 18,
    ...rect
  };
}

function createMosaicAnnotation(startPoint, endPoint) {
  const radiusX = Math.abs(endPoint.x - startPoint.x);
  const radiusY = Math.abs(endPoint.y - startPoint.y);
  const hasDrag = radiusX >= 4 || radiusY >= 4;
  const defaultRadius = 36;
  const rx = hasDrag ? Math.max(12, radiusX) : defaultRadius;
  const ry = hasDrag ? Math.max(12, radiusY) : rx;

  return {
    id: createAnnotationId(),
    type: "mosaic",
    shape: "ellipse",
    cx: startPoint.x,
    cy: startPoint.y,
    rx,
    ry,
    color: editorState.color,
    lineWidth: editorState.lineWidth,
    blockSize: 18
  };
}

function createDraftAnnotation(type, startPoint, endPoint) {
  if (type === "arrow") {
    return {
      id: "draft",
      type: "arrow",
      x1: startPoint.x,
      y1: startPoint.y,
      x2: endPoint.x,
      y2: endPoint.y,
      color: editorState.color,
      lineWidth: editorState.lineWidth
    };
  }

  if (type === "mosaic") {
    return createMosaicAnnotation(startPoint, endPoint);
  }

  return createRectAnnotation(type, startPoint, endPoint);
}

function handleEditorPointerDown(event) {
  if (!editorState.active || event.button !== 0) {
    return;
  }

  event.preventDefault();

  if (inlineTextState.active) {
    commitInlineTextEditor();
    return;
  }

  const naturalPoint = displayPointToNatural(getEditorPoint(event));

  if (editorState.tool === "text") {
    beginInlineTextEditor(naturalPoint);
    return;
  }

  if (editorState.tool === "select") {
    const selected = getAnnotationById(editorState.selectedId);
    const resizeHandle = getTextResizeHandleAtPoint(selected, naturalPoint);

    if (resizeHandle) {
      editorCanvas.setPointerCapture(event.pointerId);
      pushEditorHistory();
      editorState.interaction = {
        type: "resize-text",
        id: selected.id,
        handle: resizeHandle,
        startBounds: annotationBounds(selected)
      };
      editorCanvas.style.cursor = getResizeCursor(resizeHandle);
      renderEditorCanvas();
      updateButtonStates();
      return;
    }

    const hitId = hitTestAnnotations(editorState.annotations, naturalPoint);
    editorState.selectedId = hitId;

    if (hitId) {
      editorCanvas.setPointerCapture(event.pointerId);
      pushEditorHistory();
      editorState.interaction = {
        type: "move",
        lastPoint: naturalPoint
      };
    }

    renderEditorCanvas();
    updateButtonStates();
    return;
  }

  if (editorState.tool === "brush") {
    editorCanvas.setPointerCapture(event.pointerId);
    pushEditorHistory();
    const annotation = {
      id: createAnnotationId(),
      type: "brush",
      points: [naturalPoint],
      color: editorState.color,
      lineWidth: editorState.lineWidth
    };
    editorState.annotations.push(annotation);
    editorState.selectedId = annotation.id;
    editorState.interaction = {
      type: "brush",
      id: annotation.id
    };
    renderEditorCanvas();
    return;
  }

  pushEditorHistory();
  editorCanvas.setPointerCapture(event.pointerId);
  editorState.interaction = {
    type: "draw",
    tool: editorState.tool,
    startPoint: naturalPoint
  };
  editorState.draft = createDraftAnnotation(editorState.tool, naturalPoint, naturalPoint);
  renderEditorCanvas();
}

function handleEditorPointerMove(event) {
  if (!editorState.active) {
    return;
  }

  if (!editorState.interaction) {
    updateEditorHoverCursor(event);
    return;
  }

  event.preventDefault();
  const naturalPoint = displayPointToNatural(getEditorPoint(event));

  if (editorState.interaction.type === "move") {
    const selected = getAnnotationById(editorState.selectedId);
    const dx = naturalPoint.x - editorState.interaction.lastPoint.x;
    const dy = naturalPoint.y - editorState.interaction.lastPoint.y;

    if (selected) {
      moveAnnotation(selected, dx, dy);
      editorState.interaction.lastPoint = naturalPoint;
      renderEditorCanvas();
    }
    return;
  }

  if (editorState.interaction.type === "resize-text") {
    const annotation = getAnnotationById(editorState.interaction.id);

    if (annotation) {
      const nextRect = buildTextResizeRect(
        editorState.interaction.startBounds,
        editorState.interaction.handle,
        naturalPoint
      );
      Object.assign(annotation, resizeTextAnnotation(annotation, nextRect, editorState.interaction.handle));
      renderEditorCanvas();
    }
    return;
  }

  if (editorState.interaction.type === "brush") {
    const annotation = getAnnotationById(editorState.interaction.id);

    if (annotation) {
      annotation.points.push(naturalPoint);
      renderEditorCanvas();
    }
    return;
  }

  if (editorState.interaction.type === "draw") {
    editorState.draft = createDraftAnnotation(
      editorState.interaction.tool,
      editorState.interaction.startPoint,
      naturalPoint
    );
    renderEditorCanvas();
  }
}

function handleEditorPointerUp(event) {
  if (!editorState.active || !editorState.interaction) {
    return;
  }

  event.preventDefault();
  const naturalPoint = displayPointToNatural(getEditorPoint(event));

  if (editorState.interaction.type === "draw") {
    const annotation = createDraftAnnotation(
      editorState.interaction.tool,
      editorState.interaction.startPoint,
      naturalPoint
    );
    const bounds = annotationBounds(annotation);

    if (bounds.width >= 6 && bounds.height >= 6) {
      editorState.annotations.push(annotation);
      editorState.selectedId = annotation.id;
    } else {
      editorState.undoStack.pop();
    }
  }

  editorState.interaction = null;
  editorState.draft = null;
  editorCanvas.style.cursor = "";

  if (editorCanvas.hasPointerCapture(event.pointerId)) {
    editorCanvas.releasePointerCapture(event.pointerId);
  }

  renderEditorCanvas();
  updateButtonStates();
}

function undoEditor() {
  if (!editorState.undoStack.length) {
    return;
  }

  editorState.redoStack.push(cloneAnnotations(editorState.annotations));
  editorState.annotations = editorState.undoStack.pop();
  editorState.selectedId = null;
  renderEditorCanvas();
  updateButtonStates();
}

function redoEditor() {
  if (!editorState.redoStack.length) {
    return;
  }

  editorState.undoStack.push(cloneAnnotations(editorState.annotations));
  editorState.annotations = editorState.redoStack.pop();
  editorState.selectedId = null;
  renderEditorCanvas();
  updateButtonStates();
}

function deleteSelectedAnnotation() {
  if (!editorState.selectedId) {
    return;
  }

  pushEditorHistory();
  editorState.annotations = editorState.annotations.filter((annotation) => annotation.id !== editorState.selectedId);
  editorState.selectedId = null;
  renderEditorCanvas();
  updateButtonStates();
}

async function applyEditor(options = {}) {
  if (!record || !editorState.active) {
    return false;
  }

  if (inlineTextState.active) {
    commitInlineTextEditor();
  }

  if (!editorState.annotations.length) {
    exitEditorMode("没有编辑内容，已退出编辑");
    return true;
  }

  setBusy(true);

  try {
    setStatus("正在应用编辑");
    const image = await loadImageFromBlob(record.blob);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("浏览器无法创建编辑画布");
    }

    context.drawImage(image, 0, 0);

    for (const annotation of editorState.annotations) {
      drawAnnotation(context, annotation, { scale: 1, final: true });
    }

    const blob = await canvasToBlob(canvas, "image/png");
    record = {
      ...record,
      blob,
      width: canvas.width,
      height: canvas.height,
      edited: true,
      editedAt: Date.now()
    };

    await CaptureStore.put(record);
    refreshPreviewImage();
    renderMetadata();
    exitEditorMode(options.successMessage || "编辑已应用，可继续保存 PNG、JPEG、PDF 或复制打印");
    return true;
  } catch (error) {
    setStatus(error.message || "编辑失败");
    return false;
  } finally {
    setBusy(false);
  }
}

function getPreviewDisplaySize() {
  const bounds = previewImage.getBoundingClientRect();

  return {
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  };
}

function getOverlayPoint(event) {
  const bounds = cropOverlay.getBoundingClientRect();

  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  };
}

function updateCropBox() {
  if (!cropState.rect) {
    return;
  }

  cropBox.style.left = `${cropState.rect.x}px`;
  cropBox.style.top = `${cropState.rect.y}px`;
  cropBox.style.width = `${cropState.rect.width}px`;
  cropBox.style.height = `${cropState.rect.height}px`;
}

function setCropMode(active) {
  cropState.active = active;
  cropOverlay.hidden = !active;
  cropToolbar.hidden = !active;
  updateButtonStates();
}

async function enterCropMode() {
  if (!record) {
    return;
  }

  setBusy(true);

  try {
    setStatus("正在准备裁剪");
    await ensurePreviewReady();
    const displaySize = getPreviewDisplaySize();
    cropState.rect = createInitialCropRect(displaySize.width, displaySize.height, 0.08);
    cropState.interaction = null;
    setCropMode(true);
    updateCropBox();
    setStatus("拖动裁剪框或边角手柄，完成后点击应用裁剪");
  } catch (error) {
    setStatus(error.message || "裁剪准备失败");
  } finally {
    setBusy(false);
  }
}

function cancelCropMode(message = "已取消裁剪") {
  cropState.rect = null;
  cropState.interaction = null;
  setCropMode(false);
  setStatus(message);
}

function buildResizeRect(startRect, handle, point) {
  let left = startRect.x;
  let top = startRect.y;
  let right = startRect.x + startRect.width;
  let bottom = startRect.y + startRect.height;

  if (handle.includes("w")) {
    left = point.x;
  }

  if (handle.includes("e")) {
    right = point.x;
  }

  if (handle.includes("n")) {
    top = point.y;
  }

  if (handle.includes("s")) {
    bottom = point.y;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function updateCropFromPointer(point) {
  const interaction = cropState.interaction;

  if (!interaction) {
    return;
  }

  const displaySize = getPreviewDisplaySize();
  const dx = point.x - interaction.startPoint.x;
  const dy = point.y - interaction.startPoint.y;

  if (interaction.type === "draw") {
    cropState.rect = clampCropRect({
      x: interaction.startPoint.x,
      y: interaction.startPoint.y,
      width: dx,
      height: dy
    }, displaySize.width, displaySize.height, MIN_CROP_SIZE);
  }

  if (interaction.type === "move") {
    cropState.rect = clampCropRect({
      x: interaction.startRect.x + dx,
      y: interaction.startRect.y + dy,
      width: interaction.startRect.width,
      height: interaction.startRect.height
    }, displaySize.width, displaySize.height, MIN_CROP_SIZE);
  }

  if (interaction.type === "resize") {
    cropState.rect = clampCropRect(
      buildResizeRect(interaction.startRect, interaction.handle, point),
      displaySize.width,
      displaySize.height,
      MIN_CROP_SIZE
    );
  }

  updateCropBox();
}

function handleCropPointerDown(event) {
  if (!cropState.active || event.button !== 0) {
    return;
  }

  const point = getOverlayPoint(event);
  const handle = event.target?.dataset?.handle;
  const insideBox = event.target === cropBox || cropBox.contains(event.target);

  event.preventDefault();
  cropOverlay.setPointerCapture(event.pointerId);

  if (handle) {
    cropState.interaction = {
      type: "resize",
      handle,
      startPoint: point,
      startRect: { ...cropState.rect }
    };
    return;
  }

  if (insideBox) {
    cropState.interaction = {
      type: "move",
      startPoint: point,
      startRect: { ...cropState.rect }
    };
    return;
  }

  cropState.interaction = {
    type: "draw",
    startPoint: point,
    startRect: null
  };
  cropState.rect = clampCropRect({
    x: point.x,
    y: point.y,
    width: MIN_CROP_SIZE,
    height: MIN_CROP_SIZE
  }, getPreviewDisplaySize().width, getPreviewDisplaySize().height, MIN_CROP_SIZE);
  updateCropBox();
}

function handleCropPointerMove(event) {
  if (!cropState.interaction) {
    return;
  }

  event.preventDefault();
  updateCropFromPointer(getOverlayPoint(event));
}

function handleCropPointerUp(event) {
  if (!cropState.interaction) {
    return;
  }

  event.preventDefault();
  cropState.interaction = null;

  if (cropOverlay.hasPointerCapture(event.pointerId)) {
    cropOverlay.releasePointerCapture(event.pointerId);
  }
}

async function applyCrop() {
  if (!record || !cropState.active || !cropState.rect) {
    return;
  }

  setBusy(true);

  try {
    setStatus("正在应用裁剪");
    await ensurePreviewReady();
    const displaySize = getPreviewDisplaySize();
    const naturalRect = selectionToNaturalRect(cropState.rect, {
      displayWidth: displaySize.width,
      displayHeight: displaySize.height,
      naturalWidth: previewImage.naturalWidth,
      naturalHeight: previewImage.naturalHeight
    });
    const canvas = document.createElement("canvas");
    canvas.width = naturalRect.width;
    canvas.height = naturalRect.height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("浏览器无法创建裁剪画布");
    }

    context.drawImage(
      previewImage,
      naturalRect.x,
      naturalRect.y,
      naturalRect.width,
      naturalRect.height,
      0,
      0,
      naturalRect.width,
      naturalRect.height
    );

    const blob = await canvasToBlob(canvas, "image/png");
    record = {
      ...record,
      blob,
      width: naturalRect.width,
      height: naturalRect.height,
      cropped: true,
      crop: naturalRect,
      editedAt: Date.now()
    };

    await CaptureStore.put(record);
    refreshPreviewImage();
    renderMetadata();
    cancelCropMode("裁剪已应用，可继续保存 PNG、JPEG、PDF 或复制打印");
  } catch (error) {
    setStatus(error.message || "裁剪失败");
  } finally {
    setBusy(false);
  }
}

async function runAction(action) {
  if (!record) {
    return;
  }

  if (action === "edit") {
    if (editorState.active) {
      exitEditorMode();
      return;
    }

    await enterEditorMode();
    return;
  }

  if (action === "crop") {
    if (editorState.active) {
      setStatus("请先应用或取消编辑");
      return;
    }

    if (cropState.active) {
      cancelCropMode();
      return;
    }

    await enterCropMode();
    return;
  }

  if (cropState.active) {
    setStatus("请先应用或取消裁剪");
    return;
  }

  if (editorState.active) {
    setStatus("请先应用或取消编辑");
    return;
  }

  setBusy(true);

  try {
    if (action === "png") {
      setStatus("正在保存 PNG");
      downloadBlob(record.blob, getBaseFilename("png"));
      setStatus("PNG 已交给浏览器下载");
    }

    if (action === "jpeg") {
      setStatus("正在生成 JPEG");
      const jpegBlob = await convertToJpegBlob();
      downloadBlob(jpegBlob, getBaseFilename("jpg"));
      setStatus("JPEG 已交给浏览器下载");
    }

    if (action === "pdf") {
      setStatus("正在生成 PDF");
      const pdfBlob = await createPdfBlob();
      downloadBlob(pdfBlob, getBaseFilename("pdf"));
      setStatus("PDF 已交给浏览器下载");
    }

    if (action === "copy") {
      setStatus("正在复制到剪贴板");
      await copyToClipboard();
      setStatus("截图已复制到剪贴板");
    }

    if (action === "print") {
      setStatus("打开打印面板");
      window.print();
      setStatus("打印面板已打开");
    }
  } catch (error) {
    setStatus(error.message || "操作失败");
  } finally {
    setBusy(false);
  }
}

async function loadResult() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  if (!id) {
    throw new Error("缺少截图 ID");
  }

  record = await CaptureStore.get(id);
  if (!record) {
    throw new Error("截图记录不存在或已过期");
  }

  refreshPreviewImage();
  renderMetadata();
  setStatus("准备就绪");
}

for (const button of actionButtons) {
  button.addEventListener("click", () => {
    runAction(button.dataset.action);
  });
}

cropOverlay.addEventListener("pointerdown", handleCropPointerDown);
cropOverlay.addEventListener("pointermove", handleCropPointerMove);
cropOverlay.addEventListener("pointerup", handleCropPointerUp);
cropOverlay.addEventListener("pointercancel", handleCropPointerUp);
cropApply.addEventListener("click", applyCrop);
cropCancel.addEventListener("click", () => cancelCropMode());
editorCanvas.addEventListener("pointerdown", handleEditorPointerDown);
editorCanvas.addEventListener("pointermove", handleEditorPointerMove);
editorCanvas.addEventListener("pointerup", handleEditorPointerUp);
editorCanvas.addEventListener("pointercancel", handleEditorPointerUp);
inlineTextEditor.addEventListener("input", updateInlineTextEditorSize);
inlineTextEditor.addEventListener("keydown", (event) => {
  if (event.isComposing) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    commitInlineTextEditor();
  }

  if (event.key === "Escape") {
    event.preventDefault();
    cancelInlineTextEditor();
    setStatus(getEditorToolStatus());
  }
});
inlineTextEditor.addEventListener("blur", () => {
  commitInlineTextEditor();
});
editorApply.addEventListener("click", applyEditor);
editorCancel.addEventListener("click", () => exitEditorMode());
editorUndo.addEventListener("click", undoEditor);
editorRedo.addEventListener("click", redoEditor);
editorDelete.addEventListener("click", deleteSelectedAnnotation);
for (const button of editorToolButtons) {
  button.addEventListener("click", () => setEditorTool(button.dataset.editorTool));
}
for (const button of editorColorButtons) {
  button.addEventListener("click", () => {
    editorState.color = button.dataset.editorColor;
    updateEditorControls();
  });
}
for (const button of editorWidthButtons) {
  button.addEventListener("click", () => {
    editorState.lineWidth = Number(button.dataset.editorWidth);
    updateEditorControls();
  });
}
for (const button of editorSizeButtons) {
  button.addEventListener("click", () => {
    editorState.fontSize = Number(button.dataset.editorSize);
    updateEditorControls();
  });
}
previewImage.addEventListener("load", () => {
  syncEditorCanvasSize();
});
window.addEventListener("resize", () => {
  if (!cropState.active) {
    syncEditorCanvasSize();
  } else {
    const displaySize = getPreviewDisplaySize();
    cropState.rect = createInitialCropRect(displaySize.width, displaySize.height, 0.08);
    updateCropBox();
  }
});
window.addEventListener("keydown", (event) => {
  if (!editorState.active) {
    return;
  }

  if (event.target === inlineTextEditor) {
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      redoEditor();
    } else {
      undoEditor();
    }
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedAnnotation();
  }
});

window.addEventListener("beforeunload", () => {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
});

loadResult().catch((error) => {
  setBusy(true);
  setStatus(error.message || "截图读取失败");
});
