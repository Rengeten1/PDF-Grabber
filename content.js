// PDF Down - Content Script
// Scans the active page for downloadable documents (PDFs, Office docs, archives)
// with specialized high-precision support for LMS portals (Moodle/iLearn, Canvas, Blackboard).

(function () {
  const KNOWN_EXT_MAP = new Map([
    ["pdf", "PDF"],
    ["doc", "DOCX"], ["docx", "DOCX"], ["odt", "DOCX"], ["rtf", "DOCX"], ["txt", "TXT"],
    ["ppt", "PPTX"], ["pptx", "PPTX"], ["odp", "PPTX"],
    ["xls", "XLSX"], ["xlsx", "XLSX"], ["xlsm", "XLSX"], ["xlsb", "XLSX"], ["ods", "XLSX"],
    ["csv", "CSV"], ["tsv", "CSV"],
    ["zip", "ZIP"], ["rar", "ZIP"], ["7z", "ZIP"], ["tar", "ZIP"], ["gz", "ZIP"], ["bz2", "ZIP"], ["xz", "ZIP"],
    ["epub", "EPUB"], ["mobi", "EPUB"], ["azw3", "EPUB"],
    ["jpg", "IMG"], ["jpeg", "IMG"], ["png", "IMG"], ["gif", "IMG"], ["webp", "IMG"], ["svg", "IMG"],
    ["mp3", "AUDIO"], ["wav", "AUDIO"], ["m4a", "AUDIO"], ["flac", "AUDIO"],
    ["mp4", "VIDEO"], ["mkv", "VIDEO"], ["mov", "VIDEO"], ["avi", "VIDEO"], ["webm", "VIDEO"]
  ]);

  const WRAPPER_EXTS = new Set(["php", "html", "htm", "asp", "aspx", "jsp", "do", "action"]);

  // Recursive Shadow DOM traversal
  function getAllRoots() {
    const roots = [document];
    const queue = [document];
    while (queue.length > 0) {
      const root = queue.shift();
      try {
        const elements = root.querySelectorAll("*");
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (el.shadowRoot && !roots.includes(el.shadowRoot)) {
            roots.push(el.shadowRoot);
            queue.push(el.shadowRoot);
          }
        }
      } catch (e) {
        // Ignore restricted shadow root errors
      }
    }
    return roots;
  }

  function queryAllDeep(selector) {
    const elements = [];
    getAllRoots().forEach((root) => {
      try {
        elements.push(...Array.from(root.querySelectorAll(selector)));
      } catch (e) {
        // Ignore querySelector errors
      }
    });
    return elements;
  }

  function normalizeName(rawName) {
    if (!rawName || typeof rawName !== "string") return "";
    return rawName
      .replace(/\s+(File|PDF document|Word document|PowerPoint presentation|Folder|URL|Link)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getExtFromPath(path) {
    if (!path || typeof path !== "string") return "";
    const match = path.match(/\.([a-z0-9]{2,6})(?:$|[?#])/i);
    return match && match[1] ? match[1].toLowerCase() : "";
  }

  function normalizeType(rawType) {
    if (!rawType || typeof rawType !== "string") return "";
    const val = rawType.toLowerCase();
    if (/pdf|application\/pdf/.test(val)) return "PDF";
    if (/spreadsheetml|ms-excel|\bxlsx?\b|excel/.test(val)) return "XLSX";
    if (/wordprocessingml|msword|\bdocx?\b|word/.test(val)) return "DOCX";
    if (/presentationml|ms-powerpoint|\bpptx?\b|powerpoint|presentation/.test(val)) return "PPTX";
    if (/text\/csv|\bcsv\b/.test(val)) return "CSV";
    if (/zip|archive|compressed|\b7z\b|\brar\b|folder/.test(val)) return "ZIP";
    if (/image\//.test(val)) return "IMG";
    if (/audio\//.test(val)) return "AUDIO";
    if (/video\//.test(val)) return "VIDEO";
    if (/text\/plain|\btxt\b/.test(val)) return "TXT";
    return "";
  }

  function deriveFilenameFromUrl(url) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const lastSeg = segments.pop() || "";
      const clean = decodeURIComponent(lastSeg).trim();
      if (clean && getExtFromPath(clean)) return clean;
    } catch (e) {}
    return "";
  }

  function getPdfEntries() {
    const candidateMap = new Map();
    const typeHintMap = new Map();
    const explicitFileUrls = new Set();

    function addCandidate(rawValue, rawName = "", isExplicit = false) {
      if (!rawValue || typeof rawValue !== "string") return;
      const trimmed = rawValue.trim();
      if (!trimmed || trimmed.startsWith("javascript:") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) return;

      try {
        const url = new URL(trimmed, window.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "blob:") return;
        
        const normName = normalizeName(rawName);
        if (!candidateMap.has(url.href) || (!candidateMap.get(url.href) && normName)) {
          candidateMap.set(url.href, normName);
        }
        if (isExplicit) {
          explicitFileUrls.add(url.href);
        }
      } catch (e) {
        // Ignore invalid URLs
      }
    }

    function setTypeHint(url, rawType) {
      const type = normalizeType(rawType);
      if (type && !typeHintMap.has(url)) {
        typeHintMap.set(url, type);
      }
    }

    // 1. Tag & Attribute Pairs (embed, iframe, object, area, link)
    const selectorAttributePairs = [
      ["area[href]", "href"],
      ["iframe[src]", "src"],
      ["frame[src]", "src"],
      ["embed[src]", "src"],
      ["object[data]", "data"],
      ["link[href]", "href"],
      ["source[src]", "src"],
      ["[data-url]", "data-url"],
      ["[data-href]", "data-href"],
      ["[data-download-url]", "data-download-url"],
      ["[data-file]", "data-file"]
    ];

    selectorAttributePairs.forEach(([selector, attribute]) => {
      queryAllDeep(selector).forEach((el) => {
        const val = el.getAttribute(attribute);
        const typeAttr = el.getAttribute("type") || el.getAttribute("data-mimetype") || "";
        if (val) {
          addCandidate(val);
          if (typeAttr) {
            try {
              const absUrl = new URL(val, window.location.href).href;
              setTypeHint(absUrl, typeAttr);
            } catch (e) {}
          }
        }
      });
    });

    // 2. Deep Anchor Examination (Specialized for Moodle/iLearn 4.x/3.x & academic LMS)
    queryAllDeep("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) return;

      let absoluteUrl = "";
      try {
        absoluteUrl = new URL(href, window.location.href).href;
      } catch (e) {
        return;
      }

      // Check if wrapped inside a Moodle activity container or Course Index card
      const container = anchor.closest(".activity-item, .activity, [data-region='activity-card'], .activity-grid, li.activity, tr.activity, [data-for='cmitem'], .courseindex-item, div.item") || anchor;

      // Extract clean text (strip Moodle .accesshide / .sr-only helper tags)
      let displayName = "";
      try {
        const clone = anchor.cloneNode(true);
        clone.querySelectorAll(".accesshide, [aria-hidden='true'], .sr-only").forEach((el) => el.remove());
        displayName = normalizeName(
          (container.getAttribute && container.getAttribute("data-activityname")) ||
          anchor.getAttribute("download") ||
          clone.textContent ||
          anchor.getAttribute("title") ||
          anchor.getAttribute("aria-label") ||
          ""
        );
      } catch (e) {
        displayName = normalizeName(anchor.getAttribute("download") || anchor.textContent || "");
      }

      const hasDownloadAttr = anchor.hasAttribute("download");
      addCandidate(href, displayName, hasDownloadAttr);

      try {
        // Collect type hints from anchor AND its surrounding container (Moodle 4 places icons in sibling containers)
        const hintTokens = [];

        // Check container classes (e.g. modtype_resource, modtype_folder, etc.)
        if (container && container.className) {
          hintTokens.push(container.className);
        }

        // Check icon images, badges, and SVGs inside container
        container.querySelectorAll(".activitybadge, .badge, .activityicon, img, svg, i, span").forEach((iconEl) => {
          hintTokens.push(
            iconEl.textContent || "",
            iconEl.getAttribute("alt") || "",
            iconEl.getAttribute("title") || "",
            iconEl.getAttribute("aria-label") || "",
            iconEl.className || "",
            iconEl.getAttribute("src") || ""
          );
        });

        hintTokens.push(
          anchor.getAttribute("type") || "",
          anchor.getAttribute("data-type") || "",
          anchor.getAttribute("data-mimetype") || "",
          anchor.className || "",
          displayName || ""
        );

        const joinedHints = hintTokens.join(" ");

        // Determine specific file types from LMS cues
        if (/(fa-file-pdf|f\/pdf|\bpdf\b)/i.test(joinedHints)) {
          setTypeHint(absoluteUrl, "PDF");
          explicitFileUrls.add(absoluteUrl);
        } else if (/(fa-file-word|f\/document|f\/word|\bword\b|\bdocx\b)/i.test(joinedHints)) {
          setTypeHint(absoluteUrl, "DOCX");
          explicitFileUrls.add(absoluteUrl);
        } else if (/(fa-file-powerpoint|f\/powerpoint|\bpowerpoint\b|\bpptx\b)/i.test(joinedHints)) {
          setTypeHint(absoluteUrl, "PPTX");
          explicitFileUrls.add(absoluteUrl);
        } else if (/(fa-file-excel|f\/spreadsheet|f\/excel|\bexcel\b|\bxlsx\b)/i.test(joinedHints)) {
          setTypeHint(absoluteUrl, "XLSX");
          explicitFileUrls.add(absoluteUrl);
        } else if (/(fa-file-archive|f\/archive|\bzip\b)/i.test(joinedHints)) {
          setTypeHint(absoluteUrl, "ZIP");
          explicitFileUrls.add(absoluteUrl);
        } else {
          setTypeHint(absoluteUrl, joinedHints);
        }

        // Check explicit file extensions in name
        if (hasDownloadAttr || anchor.getAttribute("type") || /\.(pdf|docx?|pptx?|xlsx?|zip|rar|7z|csv|txt)\b/i.test(displayName)) {
          explicitFileUrls.add(absoluteUrl);
        }

        // Moodle / iLearn resource activities are documents (overwhelmingly PDFs)
        if (absoluteUrl.includes("/mod/resource/view.php")) {
          explicitFileUrls.add(absoluteUrl);
          if (!typeHintMap.has(absoluteUrl)) {
            typeHintMap.set(absoluteUrl, "PDF");
          }
        }

        // Moodle Folder: Provide direct download folder ZIP link
        if (absoluteUrl.includes("/mod/folder/view.php")) {
          const u = new URL(absoluteUrl);
          const folderId = u.searchParams.get("id");
          if (folderId) {
            const zipUrl = new URL(`/mod/folder/download_folder.php?id=${folderId}`, window.location.href).href;
            addCandidate(zipUrl, `${displayName || "Folder"} (ZIP)`, true);
            typeHintMap.set(zipUrl, "ZIP");
            explicitFileUrls.add(zipUrl);
          }
        }
      } catch (e) {}
    });

    // 3. Inline JSON-LD & Script links
    queryAllDeep("script[type='application/ld+json']").forEach((script) => {
      const text = script.textContent || "";
      const matches = text.match(/https?:\/\/[^\s"'<>]+\.(?:pdf|docx?|pptx?|xlsx?|zip)(?:[?#][^\s"'<>]*)?/gi) || [];
      matches.forEach((url) => addCandidate(url, "", true));
    });

    // URL Validator
    function isLikelyDownloadableUrl(href) {
      try {
        const url = new URL(href);
        const path = url.pathname.toLowerCase();
        const ext = getExtFromPath(path);

        // 1. Direct known file extension in pathname
        if (ext && KNOWN_EXT_MAP.has(ext)) return true;

        // 2. Explicit file URLs confirmed by LMS structures, attributes or icon tags
        if (explicitFileUrls.has(url.href)) return true;

        // 3. Known LMS / Academic patterns
        if (path.includes("/pluginfile.php/")) return true;
        if (path.includes("/mod/resource/view.php")) return true;
        if (path.includes("/mod/folder/download_folder.php")) return true;
        if (path.includes("/mod/url/view.php")) return true;
        if (url.searchParams.get("forcedownload") === "1") return true;

        // 4. Academic repositories & LMS platforms
        if (url.hostname === "arxiv.org" && path.startsWith("/pdf/")) return true;
        if (path.includes("/bbcswebdav/")) return true; // Blackboard
        if (/\/courses\/\d+\/files\/\d+/.test(path)) return true; // Canvas

        // 5. Query parameter indicates file
        for (const [key, val] of url.searchParams.entries()) {
          const valExt = getExtFromPath(val);
          if (valExt && KNOWN_EXT_MAP.has(valExt)) return true;
          const kLower = key.toLowerCase();
          if ((kLower === "file" || kLower === "filename" || kLower === "attachment" || kLower === "download") && val.trim()) {
            const extGuess = getExtFromPath(val);
            if (!WRAPPER_EXTS.has(extGuess)) return true;
          }
        }

        return false;
      } catch (e) {
        return false;
      }
    }

    // Expand nested URLs in query strings (e.g. viewer.html?file=...)
    function extractNestedCandidates(href) {
      const nested = [];
      try {
        const url = new URL(href);
        url.searchParams.forEach((val) => {
          try {
            const parsed = new URL(val, window.location.href);
            nested.push(parsed.href);
          } catch (e) {
            try {
              const decoded = decodeURIComponent(val);
              const parsed = new URL(decoded, window.location.href);
              nested.push(parsed.href);
            } catch (e2) {}
          }
        });
      } catch (e) {}
      return nested;
    }

    // Special handling when active tab itself is an LMS resource viewing page (e.g. view.php?id=...)
    if (window.location.pathname.includes("/mod/resource/view.php") || window.location.pathname.includes("/mod/url/view.php")) {
      const docTitle = document.title ? document.title.replace(/\s*-\s*iLearn.*$/i, "").trim() : "";
      const embedded = queryAllDeep("object[data], iframe[src], embed[src], a[href*='/pluginfile.php/'], .resourceworkaround a");
      let foundDirectPlugin = false;

      embedded.forEach((el) => {
        const target = el.getAttribute("data") || el.getAttribute("src") || el.getAttribute("href");
        if (target && target.includes("/pluginfile.php/")) {
          try {
            const abs = new URL(target, window.location.href).href;
            addCandidate(abs, docTitle, true);
            setTypeHint(abs, "PDF");
            foundDirectPlugin = true;
          } catch (e) {}
        }
      });

      // If on resource page and no pluginfile embedded directly yet, include current page as candidate
      if (!foundDirectPlugin) {
        addCandidate(window.location.href, docTitle, true);
        setTypeHint(window.location.href, "PDF");
      }
    }

    let pdfs = Array.from(candidateMap.keys()).filter(isLikelyDownloadableUrl);

    // If we found a direct pluginfile.php link, exclude the view.php wrapper URL so it's not duplicated
    const hasPluginFile = pdfs.some((u) => u.includes("/pluginfile.php/"));
    if (hasPluginFile && window.location.pathname.includes("/mod/resource/view.php")) {
      pdfs = pdfs.filter((u) => !u.includes("/mod/resource/view.php"));
    }

    // Expand nested candidates
    const nestedUrls = [];
    pdfs.forEach((href) => nestedUrls.push(...extractNestedCandidates(href)));
    nestedUrls.filter(isLikelyDownloadableUrl).forEach((url) => addCandidate(url));
    pdfs = Array.from(candidateMap.keys()).filter(isLikelyDownloadableUrl);

    // Check if current top frame is direct PDF
    if (document.contentType && document.contentType.toLowerCase().includes("pdf")) {
      addCandidate(window.location.href);
      pdfs = Array.from(candidateMap.keys()).filter(isLikelyDownloadableUrl);
    }

    // arXiv fallback
    if (pdfs.length === 0 && window.location.hostname === "arxiv.org") {
      const match = window.location.pathname.match(/^\/(?:abs|html)\/([^\/?#]+)/i);
      if (match && match[1]) {
        const arxivUrl = `https://arxiv.org/pdf/${match[1]}.pdf`;
        addCandidate(arxivUrl, `arXiv ${match[1]}.pdf`, true);
        pdfs = [arxivUrl];
      }
    }

    const typedEntries = pdfs.map((url) => ({
      url,
      name: candidateMap.get(url) || "",
      type: typeHintMap.get(url) || ""
    }));

    return typedEntries;
  }

  function getPdfLinks() {
    return getPdfEntries().map((entry) => entry.url);
  }

  // Cache for resolved URLs so the page never re-fetches the same link
  const resolvedCache = new Map();

  // LMS In-page Resolver for wrapper links (view.php -> pluginfile.php)
  async function resolveWrapperUrl(url) {
    if (!url) return { finalUrl: url, filename: "", type: "" };
    if (resolvedCache.has(url)) return resolvedCache.get(url);

    // If it is already a direct file (e.g. pluginfile.php/.../document.pdf), return immediately
    try {
      const parsed = new URL(url);
      const ext = getExtFromPath(parsed.pathname);
      if (ext && KNOWN_EXT_MAP.has(ext) && !WRAPPER_EXTS.has(ext)) {
        const res = { finalUrl: url, filename: deriveFilenameFromUrl(url), type: KNOWN_EXT_MAP.get(ext) || "" };
        resolvedCache.set(url, res);
        return res;
      }
    } catch (e) {
      return { finalUrl: url, filename: "", type: "" };
    }

    function parseFilenameFromCd(cd) {
      if (!cd) return "";
      const utf8 = cd.match(/filename\*=\s*UTF-8''([^;]+)/i);
      if (utf8 && utf8[1]) {
        try {
          return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ""));
        } catch (e) {}
      }
      const basic = cd.match(/filename=\s*"?([^";]+)"?/i);
      if (basic && basic[1]) return basic[1].trim();
      return "";
    }

    function extractCandidateFromHtml(html, baseUrl) {
      if (!html) return "";
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Priority 1: Moodle pluginfile.php links
        const pluginAnchor = doc.querySelector("a[href*='/pluginfile.php/']");
        if (pluginAnchor) return new URL(pluginAnchor.getAttribute("href"), baseUrl).href;

        const embedEl = doc.querySelector("object[data*='/pluginfile.php/'], iframe[src*='/pluginfile.php/'], embed[src*='/pluginfile.php/']");
        if (embedEl) {
          const src = embedEl.getAttribute("data") || embedEl.getAttribute("src");
          if (src) return new URL(src, baseUrl).href;
        }

        const anyEmbed = doc.querySelector("embed[src], iframe[src], object[data]");
        if (anyEmbed) {
          const src = anyEmbed.getAttribute("src") || anyEmbed.getAttribute("data");
          if (src) return new URL(src, baseUrl).href;
        }

        const downloadAnchor = doc.querySelector("a[download], a.aalembed, a[href$='.pdf']");
        if (downloadAnchor && downloadAnchor.getAttribute("href")) {
          return new URL(downloadAnchor.getAttribute("href"), baseUrl).href;
        }
      } catch (e) {}

      const regexMatch = html.match(/(?:href|src|data)=["']([^"']*(?:\/pluginfile\.php\/[^\s"']+|\.pdf|\.docx?|\.pptx?|\.xlsx?)[^"']*)["']/i);
      if (regexMatch && regexMatch[1]) {
        try {
          return new URL(regexMatch[1], baseUrl).href;
        } catch (e) {}
      }

      return "";
    }

    // Build single target URL with redirect=1
    let targetUrl = url;
    try {
      const u = new URL(url);
      if (u.pathname.includes("/mod/resource/view.php") || u.pathname.includes("/mod/url/view.php")) {
        u.searchParams.set("redirect", "1");
        targetUrl = u.href;
      }
    } catch (e) {}

    try {
      const res = await fetch(targetUrl, {
        method: "GET",
        credentials: "include",
        redirect: "follow"
      });

      if (res && res.ok) {
        const finalUrl = res.url || targetUrl;
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        const cd = res.headers.get("content-disposition") || "";
        const filename = parseFilenameFromCd(cd) || deriveFilenameFromUrl(finalUrl);

        // Case 1: Successfully redirected to pluginfile.php or document stream
        if (finalUrl.includes("/pluginfile.php/") || (!ct.includes("text/html") && !ct.includes("text/plain"))) {
          if (res.body && typeof res.body.cancel === "function") {
            res.body.cancel().catch(() => {});
          }
          const ext = getExtFromPath(finalUrl);
          const resolvedType = normalizeType(ct) || KNOWN_EXT_MAP.get(ext) || "PDF";
          const result = { finalUrl, filename, type: resolvedType };
          resolvedCache.set(url, result);
          return result;
        }

        // Case 2: Embedded HTML viewer returned (parse DOM for actual pluginfile link)
        if (ct.includes("text/html")) {
          const html = await res.text();
          const nestedUrl = extractCandidateFromHtml(html, finalUrl);
          if (nestedUrl) {
            const ext = getExtFromPath(nestedUrl);
            const cleanFile = deriveFilenameFromUrl(nestedUrl) || filename;
            const result = {
              finalUrl: nestedUrl,
              filename: cleanFile,
              type: KNOWN_EXT_MAP.get(ext) || "PDF"
            };
            resolvedCache.set(url, result);
            return result;
          }
        }
      }
    } catch (e) {}

    // Fallback: If it's a Moodle view.php link, ensure redirect=1 & forcedownload=1 is set
    try {
      const u = new URL(url);
      if (u.pathname.includes("/mod/resource/view.php") || u.pathname.includes("/mod/url/view.php")) {
        u.searchParams.set("redirect", "1");
        u.searchParams.set("forcedownload", "1");
        const fallback = { finalUrl: u.href, filename: "", type: "PDF" };
        resolvedCache.set(url, fallback);
        return fallback;
      }
    } catch (e) {}

    const defaultRes = { finalUrl: url, filename: "", type: "" };
    resolvedCache.set(url, defaultRes);
    return defaultRes;
  }

  // Batch resolver with gentle concurrency and stagger
  async function batchResolve(urls, concurrency = 2) {
    const results = {};
    if (!Array.isArray(urls) || urls.length === 0) return results;

    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (cursor < urls.length) {
        const idx = cursor++;
        const targetUrl = urls[idx];
        try {
          const res = await resolveWrapperUrl(targetUrl);
          if (res) results[targetUrl] = res;
        } catch (err) {}
        await new Promise((r) => setTimeout(r, 60));
      }
    });

    await Promise.all(workers);
    return results;
  }

  // Expose global endpoints for popup script executions
  window.__zenGetPdfEntries = getPdfEntries;
  window.__zenGetPdfLinks = getPdfLinks;
  window.__zenResolveUrl = resolveWrapperUrl;
  window.__zenBatchResolve = batchResolve;

  if (typeof window.pdfDownInitialized === "undefined") {
    window.pdfDownInitialized = true;
    const api = typeof browser !== "undefined" ? browser : chrome;
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.action === "scan_pdfs") {
        sendResponse({ entries: getPdfEntries() });
      }
    });
  }
})();
