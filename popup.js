document.addEventListener("DOMContentLoaded", async () => {
  const listElement = document.getElementById("pdf-list");
  const scanBtn = document.getElementById("scan-btn");
  const downloadBtn = document.getElementById("download-btn");
  const copyUrlsBtn = document.getElementById("copy-urls-btn");
  const selectAllCheckbox = document.getElementById("select-all");
  const statusMsg = document.getElementById("status-msg");

  const api = typeof browser !== "undefined" ? browser : chrome;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sanitizeFilename(value) {
    const cleaned = (value || "download.file").replace(/[\\/:*?"<>|]+/g, "_").trim();
    return cleaned || "download.file";
  }

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
    } catch (e) {
      // Ignore cache write failures.
    }
  }

  function deriveFilenameFromUrl(url) {
    const blockedWrapperExtensions = new Set(["php", "html", "htm", "asp", "aspx", "jsp"]);
    const allowedExtensions = new Set([
      "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "xlsm", "xlsb", "csv", "tsv", "txt", "rtf",
      "odt", "ods", "odp", "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
      "jpg", "jpeg", "png", "gif", "webp", "svg", "mp3", "wav", "m4a",
      "mp4", "mkv", "mov", "avi", "epub", "mobi", "azw3"
    ]);

    const extractValidExt = (value) => {
      const match = (value || "").toLowerCase().match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
      if (!match || !match[1]) return "";
      const ext = match[1].toLowerCase();
      if (blockedWrapperExtensions.has(ext)) return "";
      if (!allowedExtensions.has(ext)) return "";
      return ext;
    };

    try {
      const parsed = new URL(url);
      const fromPath = parsed.pathname.split("/").pop() || "";
      const cleanPathName = decodeURIComponent(fromPath).trim();
      if (cleanPathName && extractValidExt(cleanPathName)) {
        return cleanPathName;
      }

      const filenameParams = ["filename", "file", "name"];
      for (const key of filenameParams) {
        const value = parsed.searchParams.get(key);
        if (value && value.trim()) {
          const cleaned = decodeURIComponent(value.trim());
          if (extractValidExt(cleaned)) return cleaned;
        }
      }
    } catch (e) {
      // Fallback below.
    }

    return "download.file";
  }

  function getFileTypeLabel(itemName, itemUrl) {
    const allowedExtensions = new Set([
      "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "xlsm", "xlsb", "csv", "tsv", "txt", "rtf",
      "odt", "ods", "odp", "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
      "jpg", "jpeg", "png", "gif", "webp", "svg", "mp3", "wav", "m4a",
      "mp4", "mkv", "mov", "avi", "epub", "mobi", "azw3"
    ]);
    const blockedWrapperExtensions = new Set(["php", "html", "htm", "asp", "aspx", "jsp"]);

    const extractExt = (value) => {
      const match = (value || "").toLowerCase().match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
      if (!match || !match[1]) return "";
      const ext = match[1].toLowerCase();
      if (blockedWrapperExtensions.has(ext)) return "";
      if (!allowedExtensions.has(ext)) return "";
      return ext.toUpperCase();
    };

    const detectFromTextHints = (value) => {
      const text = (value || "").toLowerCase();
      if (!text) return "";
      if (/\bpdf\b/.test(text)) return "PDF";
      if (/\bxlsx?\b|\bexcel\b/.test(text)) return "XLSX";
      if (/\bdocx?\b|\bword\b/.test(text)) return "DOCX";
      if (/\bpptx?\b|\bpowerpoint\b|\bslides?\b/.test(text)) return "PPTX";
      if (/\bcsv\b/.test(text)) return "CSV";
      if (/\bzip\b|\brar\b|\b7z\b|\barchive\b/.test(text)) return "ZIP";
      if (/\bmp4\b|\bvideo\b/.test(text)) return "MP4";
      if (/\bmp3\b|\baudio\b/.test(text)) return "MP3";
      if (/\bjpg\b|\bjpeg\b|\bpng\b|\bgif\b|\bimage\b/.test(text)) return "IMG";
      return "";
    };

    const fromName = extractExt(itemName || "");
    if (fromName) return fromName;
    const fromNameHint = detectFromTextHints(itemName || "");
    if (fromNameHint) return fromNameHint;

    try {
      const url = new URL(itemUrl);
      const pathType = extractExt(url.pathname || "");
      if (pathType) return pathType;

      for (const [key, value] of url.searchParams.entries()) {
        if (!value) continue;
        const valueType = extractExt(value);
        if (valueType) return valueType;
        const valueHint = detectFromTextHints(value);
        if (valueHint) return valueHint;
        if (key.toLowerCase() === "forcedownload") return "FILE";
      }
    } catch (e) {
      // Fallback below.
    }

    return "FILE";
  }

  async function resolveTypesFromPageContext(tabId, items) {
    if (!tabId || !Array.isArray(items) || items.length === 0) return {};
    const probeUrls = items
      .filter((item) => item && item.url && (!item.type || item.type === "FILE"))
      .map((item) => item.url)
      .slice(0, 120);
    if (probeUrls.length === 0) return {};

    try {
      const results = await api.scripting.executeScript({
        target: { tabId },
        func: async (urls) => {
          const wrapperExts = new Set(["php", "html", "htm", "asp", "aspx", "jsp"]);
          const extMap = new Map([
            ["pdf", "PDF"], ["doc", "DOC"], ["docx", "DOCX"], ["ppt", "PPT"], ["pptx", "PPTX"],
            ["xls", "XLS"], ["xlsx", "XLSX"], ["xlsm", "XLSM"], ["xlsb", "XLSB"],
            ["csv", "CSV"], ["tsv", "TSV"], ["txt", "TXT"], ["rtf", "RTF"],
            ["zip", "ZIP"], ["rar", "RAR"], ["7z", "7Z"], ["tar", "TAR"], ["gz", "GZ"],
            ["jpg", "JPG"], ["jpeg", "JPG"], ["png", "PNG"], ["gif", "GIF"], ["webp", "WEBP"],
            ["svg", "SVG"], ["mp3", "MP3"], ["wav", "WAV"], ["m4a", "M4A"], ["mp4", "MP4"],
            ["mkv", "MKV"], ["mov", "MOV"], ["avi", "AVI"], ["epub", "EPUB"], ["mobi", "MOBI"]
          ]);

          function typeFromExt(value) {
            const match = (value || "").toLowerCase().match(/\.([a-z0-9]{2,5})(?:$|[?#;])/i);
            if (!match || !match[1]) return "";
            const ext = match[1].toLowerCase();
            if (wrapperExts.has(ext)) return "";
            return extMap.get(ext) || "";
          }

          function typeFromContentType(contentType) {
            const ct = (contentType || "").toLowerCase();
            if (!ct) return "";
            if (ct.includes("application/pdf")) return "PDF";
            if (ct.includes("spreadsheetml")) return "XLSX";
            if (ct.includes("ms-excel")) return "XLS";
            if (ct.includes("wordprocessingml")) return "DOCX";
            if (ct.includes("msword")) return "DOC";
            if (ct.includes("presentationml")) return "PPTX";
            if (ct.includes("ms-powerpoint")) return "PPT";
            if (ct.includes("text/csv")) return "CSV";
            if (ct.includes("zip")) return "ZIP";
            if (ct.includes("text/plain")) return "TXT";
            if (ct.includes("image/")) return "IMG";
            if (ct.includes("audio/")) return "AUDIO";
            if (ct.includes("video/")) return "VIDEO";
            return "";
          }

          function typeFromContentDisposition(contentDisposition) {
            if (!contentDisposition) return "";
            const utf8 = contentDisposition.match(/filename\\*\\s*=\\s*UTF-8''([^;]+)/i);
            if (utf8 && utf8[1]) {
              try {
                const decoded = decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ""));
                return typeFromExt(decoded);
              } catch (e) {
                // Ignore decode failure.
              }
            }
            const basic = contentDisposition.match(/filename\\s*=\\s*(\"?)([^\";]+)\\1/i);
            if (basic && basic[2]) return typeFromExt(basic[2].trim());
            return "";
          }

          async function probeOne(url) {
            const methods = ["HEAD", "GET"];
            for (const method of methods) {
              try {
                const response = await fetch(url, { method, credentials: "include", redirect: "follow" });
                if (!response || !response.ok) continue;

                const ct = typeFromContentType(response.headers.get("content-type") || "");
                if (ct) return ct;

                const cd = typeFromContentDisposition(response.headers.get("content-disposition") || "");
                if (cd) return cd;

                const finalFromUrl = typeFromExt(response.url || "");
                if (finalFromUrl) return finalFromUrl;
              } catch (e) {
                // Continue to next method.
              }
            }
            return "";
          }

          const resolved = {};
          for (const url of urls) {
            const type = await probeOne(url);
            if (type) resolved[url] = type;
          }
          return resolved;
        },
        args: [probeUrls]
      });

      return (results && results[0] && results[0].result) || {};
    } catch (e) {
      return {};
    }
  }

  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // Fall through to legacy copy.
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textArea);
      return copied;
    } catch (e) {
      return false;
    }
  }

  function getSelectedUrls() {
    return Array.from(document.querySelectorAll(".pdf-checkbox:checked"))
      .map((cb) => cb.value)
      .filter(Boolean);
  }

  function updateButtonState() {
    const checkedBoxes = document.querySelectorAll(".pdf-checkbox:checked");
    const count = checkedBoxes.length;

    downloadBtn.disabled = count === 0;
    copyUrlsBtn.disabled = count === 0;

    downloadBtn.textContent = count === 0 ? "Download" : `Download (${count})`;
    copyUrlsBtn.textContent = count === 0 ? "Copy URLs" : `Copy URLs (${count})`;

    const allBoxes = document.querySelectorAll(".pdf-checkbox");
    if (allBoxes.length > 0) {
      selectAllCheckbox.checked = checkedBoxes.length === allBoxes.length;
      selectAllCheckbox.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < allBoxes.length;
    }
  }

  async function scanAndRender(forceRescan = false) {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    if (!currentTab || !currentTab.id) {
      throw new Error("No active tab found.");
    }

    scanBtn.disabled = true;
    const previousScanLabel = scanBtn.textContent;
    scanBtn.textContent = "Scanning...";

    const scanFunc = () => {
      if (typeof window.__zenGetPdfEntries === "function") {
        return window.__zenGetPdfEntries();
      }
      if (typeof getPdfEntries === "function") {
        return getPdfEntries();
      }
      if (typeof window.__zenGetPdfLinks === "function") {
        return window.__zenGetPdfLinks().map((url) => ({ url, name: "" }));
      }
      if (typeof getPdfLinks === "function") {
        return getPdfLinks().map((url) => ({ url, name: "" }));
      }
      return [];
    };

    const runScan = async (allFrames, injectFileFirst) => {
      if (injectFileFirst) {
        await api.scripting.executeScript({
          target: { tabId: currentTab.id, allFrames },
          files: ["content.js"]
        });
      }

      return api.scripting.executeScript({
        target: { tabId: currentTab.id, allFrames },
        func: scanFunc
      });
    };

    async function scanOnce() {
      // Strategy 1: all frames + inject.
      try {
        return await runScan(true, true);
      } catch (e1) {
        // Strategy 2: all frames without inject (if already present).
        try {
          return await runScan(true, false);
        } catch (e2) {
          // Strategy 3: top frame + inject.
          try {
            return await runScan(false, true);
          } catch (e3) {
            // Strategy 4: top frame without inject.
            return runScan(false, false);
          }
        }
      }
    }

    try {
      // iLearn pages can hydrate links after initial paint; retry briefly before showing empty state.
      let scanResults = await scanOnce();
      for (let i = 0; i < 10; i += 1) {
        const foundAny = (scanResults || []).some((result) => Array.isArray(result.result) && result.result.length > 0);
        if (foundAny) break;
        await sleep(500);
        scanResults = await scanOnce();
      }

      const merged = new Map();
      (scanResults || []).forEach((result) => {
        const entries = Array.isArray(result.result) ? result.result : [];
        entries.forEach((entry) => {
          if (!entry) return;
          const url = typeof entry === "string" ? entry : entry.url;
        const name = typeof entry === "string" ? "" : (entry.name || "").trim();
        const type = typeof entry === "string" ? "" : (entry.type || "").trim();
        if (!url) return;

        if (!merged.has(url)) {
          merged.set(url, { url, name, type });
          return;
        }

        const existing = merged.get(url);
        if (!existing.name && name) {
          merged.set(url, { url, name, type: existing.type || type });
        } else if (!existing.type && type) {
          merged.set(url, { url, name: existing.name, type });
        }
      });
      });

      let foundPdfs = Array.from(merged.values());
      const activePageUrl = currentTab.url || "";
      const activeTabId = currentTab.id;

      if (foundPdfs.length === 0) {
        const cached = await loadLastScanCache();
        if (
          cached &&
          (cached.tabId === activeTabId || cached.pageUrl === activePageUrl) &&
          Array.isArray(cached.entries) &&
          cached.entries.length > 0
        ) {
          foundPdfs = cached.entries;
          statusMsg.textContent = "Showing last detected PDFs for this page.";
        }
      } else {
        await saveLastScanCache(activeTabId, activePageUrl, foundPdfs);
        if (forceRescan) {
          statusMsg.textContent = `${foundPdfs.length} files found!`;
        }
      }

      // Resolve unknown file types (e.g., iLearn wrapper links ending in view.php).
      const resolvedTypes = await resolveTypesFromPageContext(activeTabId, foundPdfs);
      if (resolvedTypes && Object.keys(resolvedTypes).length > 0) {
        foundPdfs = foundPdfs.map((item) => {
          const resolvedType = resolvedTypes[item.url];
          if (!resolvedType) return item;
          return { ...item, type: resolvedType };
        });
        await saveLastScanCache(activeTabId, activePageUrl, foundPdfs);
      }

      listElement.innerHTML = "";

      if (foundPdfs.length === 0) {
        listElement.innerHTML = "<div style='padding:10px; text-align:center;'>No PDFs found on this page.</div>";
        selectAllCheckbox.disabled = true;
        if (forceRescan) {
          statusMsg.textContent = "0 files found!";
        }
      } else {
        selectAllCheckbox.disabled = false;
        foundPdfs.forEach((item, index) => {
          const row = document.createElement("div");
          row.className = "pdf-item";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "pdf-checkbox";
          checkbox.value = item.url;
          checkbox.id = `pdf-${index}`;
          checkbox.checked = false;

          const label = document.createElement("label");
          label.className = "filename";
          label.htmlFor = checkbox.id;
          label.textContent = item.name || deriveFilenameFromUrl(item.url);
          label.title = item.url;

          const logo = document.createElement("span");
          logo.className = "pdf-logo";
          logo.textContent = item.type || getFileTypeLabel(label.textContent, item.url);
          logo.setAttribute("aria-hidden", "true");

          row.appendChild(checkbox);
          row.appendChild(label);
          row.appendChild(logo);
          listElement.appendChild(row);

          checkbox.addEventListener("change", updateButtonState);
        });
      }

      updateButtonState();
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = previousScanLabel || "Scan";
    }
  }

  try {
    await scanAndRender(false);
  } catch (error) {
    listElement.innerHTML = "<div class='error' style='padding:10px;'>Error scanning page.</div>";
    console.error("Scan error:", error);
  }

  selectAllCheckbox.addEventListener("change", (e) => {
    document.querySelectorAll(".pdf-checkbox").forEach((cb) => {
      cb.checked = e.target.checked;
    });
    updateButtonState();
  });

  scanBtn.addEventListener("click", async () => {
    try {
      await scanAndRender(true);
    } catch (error) {
      const cached = await loadLastScanCache();
      if (cached && Array.isArray(cached.entries) && cached.entries.length > 0) {
        statusMsg.textContent = "Scan failed; showing cached results.";
        await scanAndRender(false);
        return;
      }
      listElement.innerHTML = "<div class='error' style='padding:10px;'>Error scanning page.</div>";
      statusMsg.textContent = `Scan failed${error && error.message ? `: ${error.message}` : "."}`;
    }
  });

  downloadBtn.addEventListener("click", async () => {
    const checkedBoxes = Array.from(document.querySelectorAll(".pdf-checkbox:checked"));
    if (checkedBoxes.length === 0) return;

    downloadBtn.disabled = true;
    const originalLabel = downloadBtn.textContent;
    downloadBtn.textContent = "Working...";
    try {
      const downloadTasks = checkedBoxes.map(async (cb) => {
        const url = cb.value;
        if (!url) return false;
        const labelEl = cb.nextElementSibling;
        const websiteName = labelEl ? (labelEl.textContent || "").trim() : "";
        const filename = sanitizeFilename(websiteName || deriveFilenameFromUrl(url));

        try {
          await api.downloads.download({
            url,
            filename,
            saveAs: false,
            conflictAction: "uniquify"
          });
          return true;
        } catch (e) {
          return false;
        }
      });

      const settled = await Promise.allSettled(downloadTasks);
      const count = settled.reduce((total, result) => {
        if (result.status === "fulfilled" && result.value === true) return total + 1;
        return total;
      }, 0);
      const failed = checkedBoxes.length - count;

      if (failed > 0) {
        statusMsg.textContent = `Started ${count} download(s), ${failed} failed.`;
      } else {
        statusMsg.textContent = `Started ${count} download(s).`;
      }
    } catch (e) {
      statusMsg.textContent = `Download failed${e && e.message ? `: ${e.message}` : "."}`;
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = originalLabel || "Download";
      updateButtonState();
    }
  });

  copyUrlsBtn.addEventListener("click", async () => {
    const urls = getSelectedUrls();
    if (urls.length === 0) return;
    const copied = await copyToClipboard(urls.join("\n"));
    statusMsg.textContent = copied
      ? `Copied ${urls.length} URL(s).`
      : "Copy failed. Please select and copy manually from the list tooltips.";
  });
});
