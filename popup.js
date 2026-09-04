// PDF Down - Popup Script
// Minimalist, fast, and compliant with Mozilla Add-ons (AMO) standards.

document.addEventListener("DOMContentLoaded", async () => {
  const listElement = document.getElementById("pdf-list");
  const scanBtn = document.getElementById("scan-btn");
  const downloadBtn = document.getElementById("download-btn");
  const downloadCountBadge = document.getElementById("download-count-badge");
  const selectAllCheckbox = document.getElementById("select-all");
  const selectionStats = document.getElementById("selection-stats");
  const statusMsg = document.getElementById("status-msg");
  const progressBarBg = document.getElementById("progress-bar-bg");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const categoryPillsContainer = document.getElementById("category-pills");
  const pageHostSubtitle = document.getElementById("page-host-subtitle");

  const api = typeof browser !== "undefined" ? browser : chrome;

  // State
  let allEntries = []; // Array of { url, name, type }
  const selectedUrls = new Set();
  let activeCategory = "all";
  let searchQuery = "";
  let currentTab = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Category mapping
  const CATEGORY_MAP = {
    PDF: "pdf",
    DOC: "docs", DOCX: "docs", PPT: "docs", PPTX: "docs", ODT: "docs", ODP: "docs", RTF: "docs", TXT: "docs", EPUB: "docs",
    XLS: "sheets", XLSX: "sheets", XLSM: "sheets", XLSB: "sheets", CSV: "sheets", TSV: "sheets", ODS: "sheets",
    ZIP: "archives", RAR: "archives", "7Z": "archives", TAR: "archives", GZ: "archives", BZ2: "archives", XZ: "archives",
    IMG: "media", AUDIO: "media", VIDEO: "media"
  };

  function getCategoryForType(type) {
    const upper = (type || "").toUpperCase();
    return CATEGORY_MAP[upper] || "all";
  }

  // Minimal Notice Renderer (single quiet line, zero innerHTML)
  function renderNotice(text) {
    listElement.replaceChildren();
    if (!text) return;
    const msg = document.createElement("div");
    msg.className = "empty-notice";
    msg.textContent = text;
    listElement.appendChild(msg);
  }

  // Filename Utilities
  function sanitizeFilename(value) {
    const cleaned = (value || "download.file")
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
      .replace(/\.+$/g, "")
      .trim();
    return cleaned || "download.file";
  }

  function getExtensionFromName(name) {
    const match = (name || "").match(/\.([a-z0-9]{2,8})(?:$|[?#])/i);
    return match ? match[1].toLowerCase() : "";
  }

  function guessExtensionFromType(type) {
    const map = {
      PDF: "pdf", DOC: "doc", DOCX: "docx", PPT: "ppt", PPTX: "pptx",
      XLS: "xls", XLSX: "xlsx", CSV: "csv", ZIP: "zip", RAR: "rar",
      TXT: "txt", RTF: "rtf", EPUB: "epub", IMG: "jpg", AUDIO: "mp3", VIDEO: "mp4"
    };
    return map[(type || "").toUpperCase()] || "";
  }

  function deriveFilenameFromUrl(url) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const lastSeg = segments.pop() || "";
      const clean = decodeURIComponent(lastSeg).trim();
      if (clean && getExtensionFromName(clean)) return clean;

      for (const param of ["filename", "file", "name", "attachment"]) {
        const val = parsed.searchParams.get(param);
        if (val) {
          const cleanVal = decodeURIComponent(val).trim();
          if (cleanVal && getExtensionFromName(cleanVal)) return cleanVal;
        }
      }
    } catch (e) {}
    return "download.file";
  }

  function ensureFilenameExtension(filename, fallbackUrl, fallbackType) {
    const safeName = sanitizeFilename(filename || "");
    if (getExtensionFromName(safeName)) return safeName;
    const ext = getExtensionFromName(fallbackUrl || "") || guessExtensionFromType(fallbackType) || "pdf";
    return `${safeName}.${ext}`;
  }

  // Storage Cache
  async function loadLastScanCache() {
    try {
      const result = await api.storage.local.get({ lastScanCache: null });
      return result.lastScanCache || null;
    } catch (e) {
      return null;
    }
  }

  async function saveLastScanCache(tabId, pageUrl, entries) {
    try {
      await api.storage.local.set({
        lastScanCache: {
          tabId: typeof tabId === "number" ? tabId : null,
          pageUrl: pageUrl || "",
          entries: Array.isArray(entries) ? entries : [],
          savedAt: Date.now()
        }
      });
    } catch (e) {}
  }

  // Filter and Category UI
  function updateCategoryCounts() {
    const counts = { all: allEntries.length, pdf: 0, docs: 0, sheets: 0, archives: 0 };
    allEntries.forEach((item) => {
      const cat = getCategoryForType(item.type);
      if (counts[cat] !== undefined) counts[cat]++;
    });

    Object.keys(counts).forEach((cat) => {
      const el = document.getElementById(`count-${cat}`);
      if (el) {
        el.textContent = counts[cat] > 0 ? `(${counts[cat]})` : "";
      }
    });
  }

  function getVisibleEntries() {
    return allEntries.filter((item) => {
      // Category filter
      if (activeCategory !== "all") {
        const cat = getCategoryForType(item.type);
        if (cat !== activeCategory) return false;
      }
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const nameMatch = (item.name || "").toLowerCase().includes(q);
        const urlMatch = (item.url || "").toLowerCase().includes(q);
        const typeMatch = (item.type || "").toLowerCase().includes(q);
        if (!nameMatch && !urlMatch && !typeMatch) return false;
      }
      return true;
    });
  }

  function updateSelectionUI() {
    const visible = getVisibleEntries();
    const visibleUrls = visible.map((v) => v.url);
    const selectedVisible = visibleUrls.filter((url) => selectedUrls.has(url));

    const totalSelected = selectedUrls.size;
    downloadBtn.disabled = totalSelected === 0;

    downloadCountBadge.textContent = totalSelected > 0 ? `(${totalSelected})` : "";
    selectionStats.textContent = `${totalSelected} of ${visible.length} selected`;

    if (visibleUrls.length > 0) {
      selectAllCheckbox.checked = selectedVisible.length === visibleUrls.length;
      selectAllCheckbox.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleUrls.length;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }

    // Update row highlights
    document.querySelectorAll(".pdf-item").forEach((row) => {
      const cb = row.querySelector(".pdf-checkbox");
      if (cb) {
        row.classList.toggle("is-selected", cb.checked);
      }
    });
  }

  // Row Renderer (Pure minimalist single-line rows, safe DOM creation)
  function renderList() {
    listElement.replaceChildren();
    const visible = getVisibleEntries();

    if (allEntries.length === 0) {
      renderNotice("No files found");
      updateSelectionUI();
      return;
    }

    if (visible.length === 0) {
      renderNotice("No matches");
      updateSelectionUI();
      return;
    }

    const fragment = document.createDocumentFragment();
    visible.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "pdf-item";
      if (selectedUrls.has(item.url)) row.classList.add("is-selected");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "pdf-checkbox";
      cb.id = `item-${index}`;
      cb.checked = selectedUrls.has(item.url);

      const nameLabel = document.createElement("span");
      nameLabel.className = "filename";
      const cleanName = ensureFilenameExtension(item.name || deriveFilenameFromUrl(item.url), item.url, item.type);
      nameLabel.textContent = cleanName;
      nameLabel.title = cleanName;

      const typeBadge = document.createElement("span");
      const displayType = (item.type || getExtensionFromName(cleanName) || "PDF").toUpperCase();
      typeBadge.className = `type-badge type-${displayType.toLowerCase()}`;
      typeBadge.textContent = displayType;

      row.appendChild(cb);
      row.appendChild(nameLabel);
      row.appendChild(typeBadge);

      // Clicking anywhere on row toggles selection cleanly
      row.addEventListener("click", (e) => {
        if (e.target === cb) return; // checkbox handles its own change
        cb.checked = !cb.checked;
        if (cb.checked) {
          selectedUrls.add(item.url);
        } else {
          selectedUrls.delete(item.url);
        }
        updateSelectionUI();
      });

      cb.addEventListener("change", () => {
        if (cb.checked) {
          selectedUrls.add(item.url);
        } else {
          selectedUrls.delete(item.url);
        }
        updateSelectionUI();
      });

      fragment.appendChild(row);
    });

    listElement.appendChild(fragment);
    updateSelectionUI();
  }

  // Scanning Engine
  async function performScan(isUserRescan = false) {
    scanBtn.disabled = true;

    if (isUserRescan || allEntries.length === 0) {
      renderNotice("Scanning...");
    }

    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      currentTab = tabs[0];
      if (!currentTab || !currentTab.id) {
        throw new Error("No active tab accessible.");
      }

      // Update host pill
      try {
        const u = new URL(currentTab.url || "");
        pageHostSubtitle.textContent = u.hostname.replace(/^www\./i, "");
        pageHostSubtitle.title = currentTab.url || "";
      } catch (e) {
        pageHostSubtitle.textContent = "Active Page";
      }

      // Step 1: Inject content script
      await api.scripting.executeScript({
        target: { tabId: currentTab.id, allFrames: true },
        files: ["content.js"]
      });

      // Step 2: Fetch entries from tab
      const scanExec = await api.scripting.executeScript({
        target: { tabId: currentTab.id, allFrames: true },
        func: () => {
          if (typeof window.__zenGetPdfEntries === "function") {
            return window.__zenGetPdfEntries();
          }
          return [];
        }
      });

      // Merge results across all frames
      const mergedMap = new Map();
      (scanExec || []).forEach((frameRes) => {
        const entries = Array.isArray(frameRes.result) ? frameRes.result : [];
        entries.forEach((entry) => {
          if (!entry || !entry.url) return;
          const url = entry.url;
          const name = (entry.name || "").trim();
          const type = (entry.type || "").trim();

          if (!mergedMap.has(url)) {
            mergedMap.set(url, { url, name, type });
          } else {
            const existing = mergedMap.get(url);
            if (!existing.name && name) existing.name = name;
            if (!existing.type && type) existing.type = type;
          }
        });
      });

      let results = Array.from(mergedMap.values());

      // If nothing found and not a force rescan, check cache
      if (results.length === 0 && !isUserRescan) {
        const cached = await loadLastScanCache();
        if (cached && (cached.tabId === currentTab.id || cached.pageUrl === currentTab.url) && Array.isArray(cached.entries) && cached.entries.length > 0) {
          results = cached.entries;
          statusMsg.textContent = "Loaded last detected files for this page.";
          statusMsg.className = "status";
        }
      }

      allEntries = results;

      // Select all by default if newly detected
      if (isUserRescan || selectedUrls.size === 0) {
        selectedUrls.clear();
        allEntries.forEach((item) => selectedUrls.add(item.url));
      }

      updateCategoryCounts();
      renderList();

      if (allEntries.length > 0) {
        await saveLastScanCache(currentTab.id, currentTab.url, allEntries);

        // Progressively resolve wrapper links in background without blocking UI
        resolveWrappersInBackground(currentTab.id);
      }
    } catch (err) {
      renderNotice("No files found");
      statusMsg.textContent = "";
      statusMsg.className = "status";
    } finally {
      scanBtn.disabled = false;
    }
  }

  // Background resolution for LMS wrapper links (view.php -> pluginfile.php)
  async function resolveWrappersInBackground(tabId) {
    if (!tabId || allEntries.length === 0) return;

    const wrapperUrls = allEntries
      .map((item) => item.url)
      .filter((url) => {
        const lower = url.toLowerCase();
        return (
          lower.includes("/mod/resource/view.php") ||
          lower.includes("/mod/folder/view.php") ||
          lower.includes("/mod/url/view.php") ||
          /\.(php|asp|aspx|jsp)(?:$|[?#])/i.test(lower)
        );
      });

    if (wrapperUrls.length === 0) return;

    const CHUNK_SIZE = 4;
    for (let i = 0; i < wrapperUrls.length; i += CHUNK_SIZE) {
      const chunk = wrapperUrls.slice(i, i + CHUNK_SIZE);
      try {
        const exec = await api.scripting.executeScript({
          target: { tabId },
          func: async (urls) => {
            if (typeof window.__zenBatchResolve === "function") {
              return await window.__zenBatchResolve(urls, 2);
            }
            return {};
          },
          args: [chunk]
        });

        const resolved = (exec && exec[0] && exec[0].result) || {};
        if (Object.keys(resolved).length > 0) {
          let hasUpdates = false;
          allEntries = allEntries.map((item) => {
            const info = resolved[item.url];
            if (!info) return item;

            let changed = false;
            const updated = { ...item };
            if (info.finalUrl && info.finalUrl !== item.url) {
              if (selectedUrls.has(item.url)) {
                selectedUrls.delete(item.url);
                selectedUrls.add(info.finalUrl);
              }
              updated.url = info.finalUrl;
              changed = true;
            }
            if (info.filename && info.filename !== updated.name) {
              updated.name = info.filename;
              changed = true;
            }
            if (!updated.type && info.type) {
              updated.type = info.type;
              changed = true;
            }
            if (changed) hasUpdates = true;
            return updated;
          });

          if (hasUpdates) {
            updateCategoryCounts();
            renderList();
            if (currentTab) {
              saveLastScanCache(currentTab.id, currentTab.url, allEntries);
            }
          }
        }
      } catch (e) {
        // Ignore chunk errors
      }
    }
  }

  // Batch Downloader via Persistent Background Service
  async function startDownloads() {
    const selectedItems = allEntries.filter((item) => selectedUrls.has(item.url));
    if (selectedItems.length === 0) return;

    downloadBtn.disabled = true;
    downloadBtn.querySelector("span").textContent = "Starting...";
    statusMsg.className = "status";
    statusMsg.textContent = `Preparing ${selectedItems.length} downloads...`;
    progressBarBg.classList.add("is-active");
    progressBarFill.style.width = "5%";

    const refererUrl = currentTab && currentTab.url ? currentTab.url : "";
    const cookieStoreId = currentTab && currentTab.cookieStoreId ? currentTab.cookieStoreId : "default";

    // Prepare clean download items
    const itemsToDownload = selectedItems.map((item) => {
      let downloadUrl = item.url;
      if ((downloadUrl.includes("/mod/resource/view.php") || downloadUrl.includes("/mod/url/view.php")) && !downloadUrl.includes("redirect=")) {
        try {
          const u = new URL(downloadUrl);
          u.searchParams.set("redirect", "1");
          u.searchParams.set("forcedownload", "1");
          downloadUrl = u.href;
        } catch (e) {}
      }
      const cleanName = ensureFilenameExtension(
        item.name || deriveFilenameFromUrl(downloadUrl),
        downloadUrl,
        item.type
      );
      return {
        url: downloadUrl,
        name: cleanName,
        type: item.type,
        cookieStoreId: cookieStoreId
      };
    });

    // Hand off immediately to persistent background queue
    try {
      await api.runtime.sendMessage({
        action: "start_download_queue",
        items: itemsToDownload,
        tabId: currentTab ? currentTab.id : null,
        cookieStoreId: cookieStoreId,
        referer: refererUrl
      });
      statusMsg.className = "status success";
      statusMsg.textContent = `Downloading ${itemsToDownload.length} files in background...`;
    } catch (e) {
      // Direct download fallback in popup context
      await runDirectDownloads(itemsToDownload, refererUrl, cookieStoreId);
    }
  }

  // Fallback direct downloader if background script is unavailable
  async function runDirectDownloads(items, refererUrl, cookieStoreId) {
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      downloadBtn.querySelector("span").textContent = `Downloading ${i + 1}/${items.length}`;
      const pct = Math.round(((i + 1) / items.length) * 100);
      progressBarFill.style.width = `${pct}%`;

      const downloadOptions = {
        url: item.url,
        filename: item.name,
        saveAs: false,
        conflictAction: "uniquify"
      };

      if (cookieStoreId && cookieStoreId !== "default") {
        downloadOptions.cookieStoreId = cookieStoreId;
      }

      if (refererUrl && (refererUrl.startsWith("http://") || refererUrl.startsWith("https://"))) {
        downloadOptions.headers = [{ name: "Referer", value: refererUrl }];
      }

      try {
        await api.downloads.download(downloadOptions);
        completed++;
      } catch (err) {
        if (downloadOptions.headers) {
          delete downloadOptions.headers;
          try {
            await api.downloads.download(downloadOptions);
            completed++;
          } catch (e2) {
            if (downloadOptions.cookieStoreId) {
              delete downloadOptions.cookieStoreId;
              try {
                await api.downloads.download(downloadOptions);
                completed++;
              } catch (e3) {
                failed++;
              }
            } else {
              failed++;
            }
          }
        } else if (downloadOptions.cookieStoreId) {
          delete downloadOptions.cookieStoreId;
          try {
            await api.downloads.download(downloadOptions);
            completed++;
          } catch (e2) {
            failed++;
          }
        } else {
          failed++;
        }
      }

      await sleep(350);
    }

    downloadBtn.disabled = false;
    downloadBtn.querySelector("span").textContent = "Download";
    progressBarBg.classList.remove("is-active");
    updateSelectionUI();

    if (failed === 0) {
      statusMsg.className = "status success";
      statusMsg.textContent = `Downloaded ${completed} file(s) successfully!`;
    } else {
      statusMsg.className = "status error";
      statusMsg.textContent = `Downloaded ${completed} file(s), ${failed} failed.`;
    }
  }

  // Listen for live background download progress updates
  api.runtime.onMessage.addListener((message) => {
    if (message && message.action === "download_progress_update" && message.state) {
      const state = message.state;
      if (state.active) {
        downloadBtn.disabled = true;
        const processed = state.completed + state.failed;
        downloadBtn.querySelector("span").textContent = `${processed}/${state.total}`;
        progressBarBg.classList.add("is-active");
        const pct = Math.round((processed / state.total) * 100);
        progressBarFill.style.width = `${Math.max(5, pct)}%`;
        statusMsg.className = "status";
        statusMsg.textContent = `Downloading: ${state.currentFile}`;
      } else if (state.total > 0 && !state.active) {
        downloadBtn.disabled = false;
        downloadBtn.querySelector("span").textContent = "Download";
        progressBarBg.classList.remove("is-active");
        progressBarFill.style.width = "0%";
        updateSelectionUI();
        if (state.failed === 0) {
          statusMsg.className = "status success";
          statusMsg.textContent = `Downloaded all ${state.completed} file(s) successfully!`;
        } else {
          statusMsg.className = "status error";
          statusMsg.textContent = `Downloaded ${state.completed} file(s), ${state.failed} failed.`;
        }
      }
    }
  });

  // Check on open if background queue is already active
  try {
    const res = await api.runtime.sendMessage({ action: "get_download_queue_state" });
    if (res && res.state && res.state.active) {
      const state = res.state;
      downloadBtn.disabled = true;
      const processed = state.completed + state.failed;
      downloadBtn.querySelector("span").textContent = `${processed}/${state.total}`;
      progressBarBg.classList.add("is-active");
      const pct = Math.round((processed / state.total) * 100);
      progressBarFill.style.width = `${Math.max(5, pct)}%`;
      statusMsg.className = "status";
      statusMsg.textContent = `Downloading: ${state.currentFile}`;
    }
  } catch (e) {}

  // Event Listeners
  scanBtn.addEventListener("click", () => performScan(true));
  downloadBtn.addEventListener("click", startDownloads);

  selectAllCheckbox.addEventListener("change", (e) => {
    const visible = getVisibleEntries();
    if (e.target.checked) {
      visible.forEach((item) => selectedUrls.add(item.url));
    } else {
      visible.forEach((item) => selectedUrls.delete(item.url));
    }
    renderList();
  });

  // Search input listeners
  searchInput.addEventListener("input", (e) => {
    searchQuery = (e.target.value || "").trim();
    clearSearchBtn.classList.toggle("is-visible", searchQuery.length > 0);
    renderList();
  });

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.classList.remove("is-visible");
    renderList();
    searchInput.focus();
  });

  // Category pills listeners
  categoryPillsContainer.querySelectorAll(".tab-btn").forEach((pill) => {
    pill.addEventListener("click", () => {
      categoryPillsContainer.querySelectorAll(".tab-btn").forEach((p) => p.classList.remove("is-active"));
      pill.classList.add("is-active");
      activeCategory = pill.getAttribute("data-cat") || "all";
      renderList();
    });
  });

  // Auto-scan on open
  await performScan(false);
});
