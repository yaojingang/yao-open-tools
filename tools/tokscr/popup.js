const captureButtons = Array.from(document.querySelectorAll("[data-mode]"));
const statusText = document.getElementById("statusText");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const tabTitle = document.getElementById("tabTitle");

let pollTimer = null;

function setStatus(message, progress = null) {
  statusText.textContent = message;

  if (typeof progress === "number") {
    const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    progressText.textContent = `${normalizedProgress}%`;
    progressBar.style.width = `${normalizedProgress}%`;
  }
}

function setBusy(busy) {
  for (const button of captureButtons) {
    button.disabled = busy;
  }
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response && response.ok === false) {
    throw new Error(response.error || "操作失败");
  }
  return response;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tabs || !tabs[0]) {
    throw new Error("没有找到当前活动标签页");
  }

  return tabs[0];
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function pollJob(jobId) {
  stopPolling();

  pollTimer = setInterval(async () => {
    try {
      const response = await sendMessage({
        type: "GET_JOB_STATUS",
        jobId
      });
      const job = response.job;

      if (!job) {
        return;
      }

      setStatus(job.message || "处理中", job.progress || 0);

      if (job.state === "complete" || job.state === "error" || job.state === "cancelled") {
        stopPolling();
        setBusy(false);
      }
    } catch (error) {
      stopPolling();
      setBusy(false);
      setStatus(error.message || "状态读取失败", 0);
    }
  }, 350);
}

async function startCapture(mode) {
  setBusy(true);
  setStatus(mode === "selection" ? "切回页面拖拽选择区域" : "开始截图", 2);

  try {
    const response = await sendMessage({
      type: "START_CAPTURE",
      mode
    });
    pollJob(response.job.id);
  } catch (error) {
    setBusy(false);
    setStatus(error.message || "截图失败", 0);
  }
}

async function loadPopupTabTitle() {
  try {
    const tab = await getActiveTab();
    tabTitle.textContent = tab.title || tab.url || "当前页面";
  } catch (_error) {
    tabTitle.textContent = "当前页面";
  }
}

for (const button of captureButtons) {
  button.addEventListener("click", () => {
    startCapture(button.dataset.mode);
  });
}

loadPopupTabTitle();
