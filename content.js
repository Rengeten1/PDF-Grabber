// This function runs on the webpage itself
function getPdfEntries() {
  const candidateMap = new Map();
  const strongFileHints = new Set();
  const typeHintMap = new Map();
  const knownExtensions = new Set([
    "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "xlsm", "xlsb", "csv", "tsv", "txt", "rtf",
    "odt", "ods", "odp", "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
    "jpg", "jpeg", "png", "gif", "webp", "svg", "mp3", "wav", "m4a",
    "mp4", "mkv", "mov", "avi", "epub", "mobi", "azw3"
  ]);

  function getAllRoots() {
    const roots = [document];
    const walker = document.createTreeWalker(document.documentElement || document, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.shadowRoot) {
        roots.push(node.shadowRoot);
      }
      node = walker.nextNode();
    }
    return roots;
  }

  function queryAllDeep(selector) {
    const elements = [];
    getAllRoots().forEach((root) => {
      elements.push(...Array.from(root.querySelectorAll(selector)));
    });
    return elements;
  }

  function normalizeName(rawName) {
    if (!rawName || typeof rawName !== "string") return "";
    return rawName.replace(/\s+/g, " ").trim();
  }

  function addCandidate(rawValue, rawName = "") {
    if (!rawValue || typeof rawValue !== "string") return;

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    try {
      const url = new URL(trimmed, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      const normalizedName = normalizeName(rawName);
      if (!candidateMap.has(url.href) || (!candidateMap.get(url.href) && normalizedName)) {
        candidateMap.set(url.href, normalizedName);
      }
    } catch (e) {
      // Ignore invalid URLs.
    }
  }

  function normalizeType(rawType) {
    if (!rawType || typeof rawType !== "string") return "";
    const value = rawType.toLowerCase();
    const map = [
      [/pdf|application\/pdf/, "PDF"],
      [/\bxlsx?\b|excel|spreadsheet|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml/, "XLSX"],
      [/\bdocx?\b|word|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml/, "DOCX"],
      [/\bpptx?\b|powerpoint|presentation|application\/vnd\.ms-powerpoint|application\/vnd\.openxmlformats-officedocument\.presentationml/, "PPTX"],
      [/\bcsv\b|comma-separated/, "CSV"],
      [/\bzip\b|\brar\b|\b7z\b|archive|compressed/, "ZIP"],
      [/\bmp4\b|video\//, "MP4"],
      [/\bmp3\b|audio\//, "MP3"],
      [/\bjpg\b|\bjpeg\b|\bpng\b|\bgif\b|\bwebp\b|\bimage\//, "IMG"],
      [/\btxt\b|text\/plain/, "TXT"]
    ];
    for (const [pattern, label] of map) {
      if (pattern.test(value)) return label;
    }
    return "";
  }

  function setTypeHint(url, rawType) {
    const type = normalizeType(rawType);
    if (!type) return;
    if (!typeHintMap.has(url)) {
      typeHintMap.set(url, type);
    }
  }

  function addCandidateFromAttribute(element, attrName) {
    if (!element || !attrName) return;
    addCandidate(element.getAttribute(attrName));
  }

  function addStrongPdfHint(rawValue) {
    if (!rawValue || typeof rawValue !== "string") return;
    try {
      const url = new URL(rawValue, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      strongFileHints.add(url.href);
      addCandidate(url.href);
    } catch (e) {
      // Ignore invalid URLs.
    }
  }

  function addCandidatesFromText(text) {
    if (!text || typeof text !== "string") return;
    const regex = /https?:\/\/[^\s"'<>]+/gi;
    const matches = text.match(regex) || [];
    matches.forEach(addCandidate);
  }

  // Common tag/attribute pairs where PDF URLs appear.
  const selectorAttributePairs = [
    ["area[href]", "href"],
    ["iframe[src]", "src"],
    ["frame[src]", "src"],
    ["embed[src]", "src"],
    ["object[data]", "data"],
    ["link[href]", "href"],
    ["meta[content]", "content"]
  ];

  selectorAttributePairs.forEach(([selector, attribute]) => {
    queryAllDeep(selector).forEach(element => {
      addCandidateFromAttribute(element, attribute);
    });
  });

  // Anchor context hints (common on iLearn/Moodle pages where URL is view.php?id=...).
  queryAllDeep("a[href]").forEach(anchor => {
    const href = anchor.getAttribute("href");
    if (!href) return;

    const displayName = normalizeName(
      anchor.getAttribute("download") ||
      anchor.textContent ||
      anchor.getAttribute("title") ||
      anchor.getAttribute("aria-label") ||
      anchor.getAttribute("data-title") ||
      ""
    );

    addCandidate(href, displayName);

    try {
      const absoluteUrl = new URL(href, window.location.href).href;
      const localHints = [
        anchor.getAttribute("type") || "",
        anchor.getAttribute("data-type") || "",
        anchor.getAttribute("data-mimetype") || "",
        anchor.getAttribute("aria-label") || "",
        anchor.getAttribute("title") || "",
        anchor.className || "",
        displayName || ""
      ];

      const icon = anchor.querySelector("img, svg, i, span");
      if (icon) {
        localHints.push(icon.getAttribute("alt") || "");
        localHints.push(icon.getAttribute("title") || "");
        localHints.push(icon.getAttribute("aria-label") || "");
        localHints.push(icon.className || "");
        localHints.push(icon.getAttribute("src") || "");
      }

      if (anchor.parentElement) {
        localHints.push(anchor.parentElement.className || "");
        const parentText = (anchor.parentElement.textContent || "").trim();
        if (parentText) localHints.push(parentText);
      }

      setTypeHint(absoluteUrl, localHints.join(" "));
    } catch (e) {
      // Ignore malformed URL for hints.
    }

    const textSignals = [
      anchor.textContent || "",
      anchor.getAttribute("title") || "",
      anchor.getAttribute("aria-label") || "",
      anchor.getAttribute("data-title") || ""
    ].join(" ").toLowerCase();

    if (/\b(pdf|docx?|pptx?|xlsx?|zip|file|download|resource|attachment)\b|\.(pdf|docx?|pptx?|xlsx?|zip|rar|7z|csv|txt)\b/.test(textSignals)) {
      addStrongPdfHint(href);
    }
  });

  // Parse inline JSON-LD/script text for hardcoded absolute URLs.
  queryAllDeep("script[type='application/ld+json'], script:not([src])").forEach(script => {
    addCandidatesFromText(script.textContent || "");
  });

  function hasKnownExtension(value) {
    if (!value || typeof value !== "string") return false;
    const lower = value.toLowerCase();
    for (const ext of knownExtensions) {
      if (lower.includes(`.${ext}`)) return true;
    }
    return false;
  }

  function isLikelyDownloadableUrl(href) {
    try {
      const url = new URL(href);
      const lowerHref = href.toLowerCase();
      const path = url.pathname.toLowerCase();
      const extMatch = path.match(/\.([a-z0-9]{2,5})$/i);
      if (extMatch && knownExtensions.has(extMatch[1].toLowerCase())) return true;
      if (hasKnownExtension(lowerHref)) return true;
      if (url.hostname === "arxiv.org" && path.startsWith("/pdf/")) return true;
      if (url.searchParams.has("pdf")) return true;
      if (path.includes("/pluginfile.php/")) return true;
      if (path.includes("/mod/resource/view.php")) return true;
      if (path.includes("/mod/folder/view.php") && url.searchParams.has("id")) return true;
      if (url.searchParams.get("forcedownload") === "1") return true;
      if (strongFileHints.has(url.href)) return true;

      for (const [key, value] of url.searchParams.entries()) {
        const lowerKey = key.toLowerCase();
        const lowerValue = value.toLowerCase();
        if (hasKnownExtension(lowerValue)) return true;
        if ((lowerKey === "file" || lowerKey === "filename" || lowerKey === "download" || lowerKey === "attachment") && lowerValue) {
          return true;
        }
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  // Expand nested URLs found in query-string parameters.
  function extractNestedCandidates(href) {
    const nested = [];
    try {
      const url = new URL(href);
      url.searchParams.forEach((value) => {
        try {
          nested.push(new URL(value, window.location.href).href);
          return;
        } catch (e) {
          // Keep trying decoded form.
        }

        try {
          const decoded = decodeURIComponent(value);
          nested.push(new URL(decoded, window.location.href).href);
        } catch (e) {
          // Ignore values that are not URLs.
        }
      });
    } catch (e) {
      // Ignore invalid root URL.
    }

    return nested;
  }

  let pdfs = Array.from(candidateMap.keys()).filter(isLikelyDownloadableUrl);

  // Try extracting embedded destination URLs from the PDF-like links.
  const nestedUrls = [];
  pdfs.forEach(href => {
    nestedUrls.push(...extractNestedCandidates(href));
  });
  nestedUrls.filter(isLikelyDownloadableUrl).forEach(url => addCandidate(url));
  pdfs = Array.from(candidateMap.keys()).filter(isLikelyDownloadableUrl);

  // Include current page URL if this frame is already a direct PDF response.
  if (document.contentType && document.contentType.toLowerCase().includes("pdf")) {
    addCandidate(window.location.href);
    pdfs = Array.from(candidateMap.keys()).filter(isLikelyDownloadableUrl);
  }

  // arXiv fallback: construct PDF URL from /abs/ or /html/ when no links found
  if (pdfs.length === 0 && window.location.hostname === "arxiv.org") {
    const path = window.location.pathname;
    const match = path.match(/^\/(?:abs|html)\/([^\/?#]+)/i);
    if (match && match[1]) {
      const arxivId = match[1];
      const arxivUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
      addCandidate(arxivUrl, `arXiv ${arxivId}.pdf`);
      pdfs = [arxivUrl];
    }
  }

  const entries = pdfs.map(url => ({ url, name: candidateMap.get(url) || "" }));
  const typedEntries = entries.map(entry => ({
    url: entry.url,
    name: entry.name,
    type: typeHintMap.get(entry.url) || ""
  }));

  if (window.pdfGrabberDebug === true) {
    console.debug("[PDF Grabber] Found files:", typedEntries);
  }

  return typedEntries;
}

function getPdfLinks() {
  return getPdfEntries().map(entry => entry.url);
}

// Expose stable function names for executeScript() calls across browsers.
window.__zenGetPdfEntries = getPdfEntries;
window.__zenGetPdfLinks = getPdfLinks;

// Listen for the request from the popup
// Use a global flag to ensure we only add the listener once per injection environment
if (typeof window.pdfGrabberInitialized === "undefined") {
  window.pdfGrabberInitialized = true;
  
  // Choose the appropriate API (browser or chrome)
  const api = typeof browser !== "undefined" ? browser : chrome;

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scan_pdfs") {
      sendResponse({ pdfs: getPdfLinks() });
    }
  });
}
