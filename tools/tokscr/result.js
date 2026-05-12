const previewImage = document.getElementById("previewImage");
const captureTitle = document.getElementById("captureTitle");
const captureUrl = document.getElementById("captureUrl");
const captureMode = document.getElementById("captureMode");
const captureSize = document.getElementById("captureSize");
const captureTime = document.getElementById("captureTime");
const statusText = document.getElementById("statusText");
const actionButtons = Array.from(document.querySelectorAll("[data-action]"));

const MODE_LABELS = {
  full: "完整页面",
  visible: "可见区域",
  selection: "选择区域",
  content: "主体去噪"
};

let record = null;
let objectUrl = null;

function setStatus(message) {
  statusText.textContent = message;
}

function setBusy(busy) {
  for (const button of actionButtons) {
    button.disabled = busy;
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
  const mode = MODE_LABELS[record?.mode] || "截图";
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

async function runAction(action) {
  if (!record) {
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

  objectUrl = URL.createObjectURL(record.blob);
  previewImage.src = objectUrl;
  captureTitle.textContent = record.title || "webpage";
  captureUrl.textContent = record.url || "";
  captureMode.textContent = MODE_LABELS[record.mode] || record.mode || "-";
  captureSize.textContent = `${record.width} × ${record.height}`;
  captureTime.textContent = new Date(record.createdAt).toLocaleString();
  setStatus("准备就绪");
}

for (const button of actionButtons) {
  button.addEventListener("click", () => {
    runAction(button.dataset.action);
  });
}

window.addEventListener("beforeunload", () => {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
});

loadResult().catch((error) => {
  setBusy(true);
  setStatus(error.message || "截图读取失败");
});
