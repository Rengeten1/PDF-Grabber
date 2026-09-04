// PDF Down - Background Script
// Manages reliable persistent download queues that survive popup closing,
// with full support for Firefox / Zen Browser multi-account containers & workspaces.

const api = typeof browser !== "undefined" ? browser : chrome;

let queueState = {
  active: false,
  total: 0,
  completed: 0,
  failed: 0,
  currentFile: ""
};

let activeQueue = [];
let queueReferer = "";
let queueTabId = null;
let queueCookieStoreId = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeFilename(value) {
  const cleaned = (value || "download.file")
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
    .replace(/\.+$/g, "")
    .trim();
  return cleaned || "download.file";
}

function updateBadge() {
  try {
    const remaining = queueState.total - (queueState.completed + queueState.failed);
    if (queueState.active && remaining > 0) {
      api.action.setBadgeText({ text: String(remaining) });
      api.action.setBadgeBackgroundColor({ color: "#2563eb" });
    } else if (queueState.completed > 0 && !queueState.active) {
      api.action.setBadgeText({ text: "✓" });
      api.action.setBadgeBackgroundColor({ color: "#16a34a" });
      setTimeout(() => {
        try {
          api.action.setBadgeText({ text: "" });
        } catch (e) {}
      }, 6000);
    } else {
      api.action.setBadgeText({ text: "" });
    }
  } catch (e) {}
}

function broadcastProgress() {
  try {
    api.runtime.sendMessage({
      action: "download_progress_update",
      state: { ...queueState }
    }).catch(() => {
      // Popup may be closed, ignore
    });
  } catch (e) {}

  try {
    api.storage.local.set({ downloadQueueState: queueState }).catch(() => {});
  } catch (e) {}
}

async function resolveUrlInTab(tabId, url) {
  if (!tabId || !url) return null;
  try {
    const exec = await api.scripting.executeScript({
      target: { tabId },
      func: async (u) => {
        if (typeof window.__zenResolveUrl === "function") {
          return await window.__zenResolveUrl(u);
        }
        return null;
      },
      args: [url]
    });
    return (exec && exec[0] && exec[0].result) || null;
  } catch (e) {
    return null;
  }
}

async function processDownloadQueue() {
  if (queueState.active) return;
  queueState.active = true;

  updateBadge();
  broadcastProgress();

  while (activeQueue.length > 0) {
    const item = activeQueue.shift();
    queueState.currentFile = item.name || "file";
    broadcastProgress();

    let downloadUrl = item.url;
    let filenameToUse = item.name;

    // Step 1: If URL is a Moodle/LMS wrapper link, resolve via the tab's session
    const isWrapper = downloadUrl.includes("/mod/resource/view.php") ||
                      downloadUrl.includes("/mod/url/view.php") ||
                      /\.(php|asp|aspx|jsp)(?:$|[?#])/i.test(downloadUrl);

    if (isWrapper && queueTabId) {
      try {
        const resolved = await resolveUrlInTab(queueTabId, downloadUrl);
        if (resolved && resolved.finalUrl && (resolved.finalUrl.includes("/pluginfile.php/") || !resolved.finalUrl.includes("view.php"))) {
          downloadUrl = resolved.finalUrl;
          if (resolved.filename) filenameToUse = resolved.filename;
        } else {
          // Add redirect=1 and forcedownload=1 for direct 303 download
          const u = new URL(downloadUrl);
          u.searchParams.set("redirect", "1");
          u.searchParams.set("forcedownload", "1");
          downloadUrl = u.href;
        }
      } catch (e) {
        try {
          const u = new URL(downloadUrl);
          u.searchParams.set("redirect", "1");
          u.searchParams.set("forcedownload", "1");
          downloadUrl = u.href;
        } catch (e2) {}
      }
    }

    const cleanName = sanitizeFilename(filenameToUse || "download.file");
    const downloadOptions = {
      url: downloadUrl,
      filename: cleanName,
      saveAs: false,
      conflictAction: "uniquify"
    };

    // Pass container cookieStoreId for Zen Browser workspaces & container tabs
    const targetCookieStore = item.cookieStoreId || queueCookieStoreId;
    if (targetCookieStore && targetCookieStore !== "default") {
      downloadOptions.cookieStoreId = targetCookieStore;
    }

    if (queueReferer && (queueReferer.startsWith("http://") || queueReferer.startsWith("https://"))) {
      downloadOptions.headers = [{ name: "Referer", value: queueReferer }];
    }

    // Step 2: Attempt download with intelligent retries
    let downloadSucceeded = false;
    try {
      await api.downloads.download(downloadOptions);
      downloadSucceeded = true;
    } catch (err) {
      // Retry 1: Remove Referer header if browser restricts custom headers
      if (downloadOptions.headers) {
        delete downloadOptions.headers;
        try {
          await api.downloads.download(downloadOptions);
          downloadSucceeded = true;
        } catch (retryErr1) {
          // Retry 2: Remove cookieStoreId if container ID was invalid
          if (downloadOptions.cookieStoreId) {
            delete downloadOptions.cookieStoreId;
            try {
              await api.downloads.download(downloadOptions);
              downloadSucceeded = true;
            } catch (retryErr2) {}
          }
        }
      } else if (downloadOptions.cookieStoreId) {
        delete downloadOptions.cookieStoreId;
        try {
          await api.downloads.download(downloadOptions);
          downloadSucceeded = true;
        } catch (retryErr2) {}
      }
    }

    if (downloadSucceeded) {
      queueState.completed++;
    } else {
      queueState.failed++;
    }

    updateBadge();
    broadcastProgress();

    // 350ms pacing delay between downloads to ensure browser and server stability
    await sleep(350);
  }

  queueState.active = false;
  queueState.currentFile = "";
  updateBadge();
  broadcastProgress();
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === "start_download_queue") {
    const items = Array.isArray(message.items) ? message.items : [];
    queueReferer = message.referer || "";
    queueTabId = typeof message.tabId === "number" ? message.tabId : null;
    queueCookieStoreId = message.cookieStoreId || "";
    activeQueue = [...items];
    queueState = {
      active: false,
      total: items.length,
      completed: 0,
      failed: 0,
      currentFile: ""
    };
    processDownloadQueue();
    sendResponse({ status: "started", total: items.length });
    return true;
  }

  if (message && message.action === "get_download_queue_state") {
    sendResponse({ state: { ...queueState } });
    return true;
  }
});
