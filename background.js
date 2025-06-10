// background.js

let nadekoServerPort = 12345; // Default port

// Cache for localhost availability to reduce repeated checks.
const localhostStatusCache = {
    isAlive: false,
    lastChecked: 0,
    checkInterval: 5000 // Cache for 5 seconds
};

// --- REMOVED: Debounce tracker for showMediaPopup messages ---
// const lastMediaPopupSent = new Map(); // Map tabId to {url: string, timestamp: number}
// const POPUP_SEND_DEBOUNCE_MS = 1000; // Only send popup message every 1 second per unique URL/tab
// --- END REMOVED ---

/**
 * Initializes the Nadeko server port from storage.
 * This should be called once at the start of the background script.
 */
async function initNadekoPort() {
    try {
        const result = await browser.storage.local.get('nadekoPort');
        nadekoServerPort = result.nadekoPort || 12345;
        console.debug(`[Background Script] Initialized Nadeko server port: ${nadekoServerPort}`);
    } catch (error) {
        console.error('[Background Script] Error initializing Nadeko port from storage:', error);
        nadekoServerPort = 12345; // Fallback to default
    }
}

// Call initialization immediately
initNadekoPort();


/**
 * Checks if the local application on localhost:nadekoServerPort is alive.
 * Uses a cache to avoid excessive checks.
 * @param {boolean} forceCheck - If true, bypasses the cache and performs a new fetch.
 * @returns {Promise<boolean>} - True if alive, false otherwise.
 */
async function isLocalhostAlive(forceCheck = false) {
    const now = Date.now();
    if (!forceCheck && now - localhostStatusCache.lastChecked < localhostStatusCache.checkInterval) {
        console.debug(`[Background Script] Localhost status from cache: ${localhostStatusCache.isAlive}`);
        return localhostStatusCache.isAlive;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000); // 1-second timeout

        // Use the dynamically set nadekoServerPort
        const response = await fetch(`http://localhost:${nadekoServerPort}/`, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const alive = response.ok || response.type === 'opaque';
        localhostStatusCache.isAlive = alive;
        localhostStatusCache.lastChecked = now;
        console.debug(`[Background Script] Localhost check: ${alive ? 'Alive' : 'Not Alive'} on port ${nadekoServerPort} (Forced: ${forceCheck})`);
        return alive;
    } catch (error) {
        localhostStatusCache.isAlive = false;
        localhostStatusCache.lastChecked = now;
        console.warn(`[Background Script] Localhost check failed on port ${nadekoServerPort}: ${error.message}`);
        return false;
    }
}


// Function to send URL to a local application (Nadeko Downloader)
async function sendUrlToApp(url, filename = null) {
  if (!nadekoServerPort) {
      await initNadekoPort();
  }
  
  console.debug(`[Background Script] Attempting to send URL to Nadeko App: ${url} (Filename: ${filename}) on port ${nadekoServerPort}`);

  return new Promise((resolve, reject) => {
    fetch(`http://localhost:${nadekoServerPort}`, {
      method: 'POST',
      body: JSON.stringify({ url: url, filename: filename }),
          headers: { 'Content-Type': 'application/json' }
    })
    .then(response => {
      if (response.ok) {
        console.debug('[Background Script] Successfully sent URL to Nadeko App:', url);
        resolve();
      } else {
        console.error('[Background Script] Failed to send URL to Nadeko application. Status:', response.status);
        reject(new Error(`Failed to send URL. Status: ${response.status}`));
      }
    })
    .catch(error => {
      console.error('[Background Script] Error sending URL to Nadeko App:', error);
      reject(error);
    });
  });
}

// Create a context menu item for "Send to Nadeko"
browser.contextMenus.create({
  id: "send-to-nadeko",
  title: "Send to Nadeko",
  contexts: ["page", "link", "video", "audio"]
});

// Listener for context menu clicks
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "send-to-nadeko") {
    const urlToSend = info.linkUrl || info.srcUrl || info.pageUrl;
    if (urlToSend) {
        console.debug(`[Background Script] Context menu clicked. Sending URL: ${urlToSend}`);
        sendUrlToApp(urlToSend)
        .catch(error => {
            console.error(`[Background Script] Failed to send URL ${urlToSend} via context menu:`, error);
        });
    } else {
        console.warn("[Background Script] No valid URL found to send via context menu.");
    }
  }
});


// Using a Map to store unique media URLs found across all tabs
const scrapedMediaUrls = new Map();

// Cache for fetchMediaHeaders results.
const mediaDetailsCache = new Map();

/**
 * Performs a HEAD request to get Content-Type and Content-Disposition headers.
 * @param {string} url - The URL to check.
 * @returns {Promise<{valid: boolean, contentType: string | null, contentDisposition: string | null}>}
 */
async function fetchMediaHeaders(url) {
    if (mediaDetailsCache.has(url)) {
        return mediaDetailsCache.get(url);
    }

    const promise = (async () => {
        try {
            const response = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
            
            if (!response.ok) {
                return { valid: false, contentType: null, contentDisposition: null };
            }

            const contentType = response.headers.get('Content-Type');
            const contentDisposition = response.headers.get('Content-Disposition');

            const isMedia = contentType && (
                contentType.startsWith('video/') ||
                contentType.startsWith('audio/') ||
                contentType.startsWith('image/gif') ||
                contentType.includes('mpegurl') ||
                contentType.includes('dash+xml') ||
                contentType.includes('application/octet-stream')
            );

            return { valid: isMedia, contentType, contentDisposition };
        } catch (error) {
            console.warn(`[Background Script] Failed to fetch headers for ${url}:`, error);
            return { valid: false, contentType: null, contentDisposition: null };
        }
    })();

    mediaDetailsCache.set(url, promise);
    return promise;
}


/**
 * Derives a suitable filename from a URL, Content-Type, and Content-Disposition.
 * @param {string} url - The original URL.
 * @param {string | null} contentType - The Content-Type header.
 * @param {string | null} contentDisposition - The Content-Disposition header.
 * @returns {string} - The derived filename.
 */
function deriveFilename(url, contentType, contentDisposition) {
    let filename = '';

    if (contentDisposition) {
        const match = /filename\*?=['"]?(?:UTF-8''|)(.*?)(?:['"]|$|;|\s)/i.exec(contentDisposition);
        if (match && match[1]) {
            try {
                filename = decodeURIComponent(match[1].trim());
            } catch (e) {
                console.warn(`[Background Script] Failed to decode Content-Disposition filename: ${match[1]}`);
                filename = match[1].trim();
            }
        }
    }

    if (!filename) {
        try {
            const urlObj = new URL(url);
            filename = urlObj.pathname.split('/').pop() || 'unknown';
            filename = filename.split('?')[0].split('#')[0];
        } catch (e) {
            console.warn(`[Background Script] Failed to parse URL for filename: ${url}`, e);
            filename = 'unknown_file';
        }
    }

    let fileExtension = '';
    if (contentType) {
        const typeParts = contentType.split('/');
        if (typeParts.length > 1) {
            fileExtension = typeParts[1].toLowerCase().split(';')[0];
            if (fileExtension === 'jpeg') fileExtension = 'jpg';
            if (fileExtension === 'x-mpegurl') fileExtension = 'm3u8';
            if (fileExtension === 'vnd.apple.mpegurl') fileExtension = 'm3u8';
            if (fileExtension === 'dash+xml') fileExtension = 'mpd';
            if (fileExtension === 'octet-stream' && url.includes('.bin')) fileExtension = 'bin';
            if (fileExtension === 'octet-stream' && url.includes('.ts')) fileExtension = 'ts';
            if (fileExtension === 'mp4a-latm') fileExtension = 'aac';
        }
    }

    const currentExt = filename.includes('.') ? filename.split('.').pop() : '';

    if (fileExtension && currentExt.toLowerCase() !== fileExtension) {
        const mediaExtensions = ['mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'avi', 'mov', 'mkv', 'wmv', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp', 'm3u8', 'mpd', 'ts', 'bin'];
        if (!mediaExtensions.includes(currentExt.toLowerCase())) {
            filename = `${filename}.${fileExtension}`;
        }
    }

    filename = sanitizeFilenameCharacters(filename);

    if (filename === 'downloaded_file' && fileExtension) {
        filename = `downloaded_file.${fileExtension}`;
    } else if (filename === 'unknown_file' && fileExtension) {
         filename = `unknown_file.${fileExtension}`;
    } else if (filename === 'unknown' && fileExtension) {
         filename = `unknown.${fileExtension}`;
    }
    else if (filename === '' && fileExtension) {
        filename = `media_file.${fileExtension}`;
    } else if (filename === '') {
        filename = 'media_file';
    }

    return filename;
}


/**
 * Sanitizes a string to be a valid filename.
 * @param {string} filename - The original filename.
 * @returns {string} - The sanitized filename.
 */
function sanitizeFilenameCharacters(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    let namePart = filename;
    let extPart = '';

    if (lastDotIndex > 0) {
        namePart = filename.substring(0, lastDotIndex);
        extPart = filename.substring(lastDotIndex);
    }

    namePart = namePart.replace(/[/?%*:|"<>\\/]/g, '_');
    namePart = namePart.replace(/^\.+|\.+$/g, '').trim();

    let cleanedFilename = namePart + extPart;

    const MAX_LENGTH = 200;
    if (cleanedFilename.length > MAX_LENGTH) {
        if (lastDotIndex > 0) {
            const originalNameLength = namePart.length;
            const originalExtLength = extPart.length;
            const availableNameLength = MAX_LENGTH - originalExtLength;

            if (availableNameLength > 0) {
                cleanedFilename = namePart.substring(0, availableNameLength) + extPart;
            } else {
                cleanedFilename = extPart.substring(0, MAX_LENGTH);
            }
        } else {
            cleanedFilename = cleanedFilename.substring(0, MAX_LENGTH);
        }
    }

    if (cleanedFilename.length === 0) {
        return 'downloaded_file';
    }

    return cleanedFilename;
}



/**
 * Gets full media details (validity, content type, derived filename) for a given URL.
 * @param {string} url - The URL of the potential media.
 * @returns {Promise<{url: string, filename: string, validMedia: boolean}>}
 */
async function getMediaDetails(url) {
    const { valid, contentType, contentDisposition } = await fetchMediaHeaders(url);
    const filename = deriveFilename(url, contentType, contentDisposition);
    return { url, filename, validMedia: valid };
}


/**
 * Adds a URL (along with its derived filename) to the scrapedMediaUrls set for a specific tab.
 * This function also sends the `showMediaPopup` message to the content script.
 * @param {number} tabId - The ID of the tab where the URL was found.
 * @param {string} url - The raw URL of the media.
 * @param {string} source - 'webRequest' or 'contentScript' to indicate where the URL came from.
 */
async function addMediaUrl(tabId, url, source) {
  const mediaItem = await getMediaDetails(url);

  if (!mediaItem.validMedia) {
    return;
  }

  if (!scrapedMediaUrls.has(tabId)) {
    scrapedMediaUrls.set(tabId, new Set());
  }
  const urlsForTab = scrapedMediaUrls.get(tabId);

  let isAlreadyAdded = false;
  for (const item of urlsForTab) {
      if (item.url === mediaItem.url) {
          isAlreadyAdded = true;
          break;
      }
  }

  if (!isAlreadyAdded) {
    urlsForTab.add(mediaItem);
    console.debug(`[Background Script] Added media item (${source}): ${mediaItem.filename} (${mediaItem.url}) for tab ${tabId}`);
    
    // Notify the main browser action popup to update its list
    browser.runtime.sendMessage({ type: "urlAdded", mediaItem: mediaItem, tabId: tabId }).catch(error => {
        // This is fine if the popup isn't open
    });

    // Only send message to content script if tabId is valid (>= 0)
    if (tabId >= 0) {
        // --- NEW: No more debouncing for showMediaPopup in background script ---
        browser.tabs.sendMessage(tabId, {
            type: "showMediaPopup",
            mediaItem: mediaItem
        }).catch(error => {
            console.warn(`[Background Script] Could not send showMediaPopup to tab ${tabId}:`, error);
        });
    } else {
        console.debug(`[Background Script] Skipping showMediaPopup for invalid tabId: ${tabId}.`);
    }
  }
}

/**
 * Checks if an XHR URL is likely related to media, based on its path and query parameters.
 * This is a heuristic to reduce unnecessary HEAD requests.
 * @param {string} url - The XHR URL to check.
 * @returns {boolean} - True if the URL is likely a media stream/manifest/segment.
 */
function isLikelyMediaXHR(url) {
    const mediaExtensions = /\.(m3u8|mpd|ts|aac|mp4|webm|m4s|mp4a|vtt|f4m|ism|isml|dash|json|bin)(\?.*)?$/i;
    const streamingPatterns = /(chunk|segment|playlist|manifest|stream|video|audio|hls|dash)/i;
    const knownMediaDomains = /(youtube\.com|vimeo\.com|cdn\.videoplatform\.com|akamaihd\.net|cloudfront\.net|mediaservices\.windows\.net|video\.twimg\.com)/i;

    return mediaExtensions.test(url) || streamingPatterns.test(url) || knownMediaDomains.test(url);
}

// --- WebRequest Listener for detecting media and general downloads ---
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const relevantResourceTypes = ['media', 'object', 'sub_frame', 'image'];

    if (relevantResourceTypes.includes(details.type)) {
      if (details.type === 'sub_frame') {
          if (details.url.includes('youtube.com/embed/') || details.url.includes('vimeo.com/video/')) {
              addMediaUrl(details.tabId, details.url, 'webRequest');
          }
      } else {
          addMediaUrl(details.tabId, details.url, 'webRequest').catch(error => {
            console.error(`[Background Script] Error adding URL from webRequest: ${details.url}`, error);
          });
      }
    } else if (details.type === 'xmlhttprequest') {
        if (isLikelyMediaXHR(details.url)) {
            addMediaUrl(details.tabId, details.url, 'webRequest').catch(error => {
                console.error(`[Background Script] Error adding URL from XHR webRequest: ${details.url}`, error);
            });
        }
    }
  },
  { urls: ["<all_urls>"], types: ['media', 'object', 'sub_frame', 'image', 'xmlhttprequest'] },
  ["blocking"]
);


/**
 * Handles an intercepted download request.
 * Checks localhost status and either sends to Nadeko or re-initiates browser download.
 * @param {string} url - The URL to download.
 * @param {string} contentType - The Content-Type header.
 * @param {string} contentDisposition - The Content-Disposition header.
 * @param {number} tabId - The ID of the tab where the download originated.
 */
async function handleInterceptedDownload(url, contentType, contentDisposition, tabId) {
    console.debug(`[Background Script] Handling intercepted download: ${url}`);
    const isAlive = await isLocalhostAlive();
    const filename = deriveFilename(url, contentType, contentDisposition);

    if (isAlive) {
        console.debug(`[Background Script] Localhost is alive. Sending to Nadeko: ${url} as ${filename}`);
        sendUrlToApp(url, filename)
            .then(() => {
                browser.runtime.sendMessage({ type: "downloadHandledByNadeko", url: url, filename: filename, tabId: tabId }).catch(e => {});
            })
            .catch(error => {
                console.error(`[Background Script] Error sending to Nadeko, falling back to browser download: ${url}`, error);
                browser.downloads.download({
                    url: url,
                    filename: filename,
                    conflictAction: 'uniquify'
                }).catch(dlError => console.error(`[Background Script] Fallback download failed: ${url}`, dlError));
            });
    } else {
        console.debug(`[Background Script] Localhost is not alive. Re-initiating browser download for: ${url}`);
        browser.downloads.download({
            url: url,
            filename: filename,
            conflictAction: 'uniquify'
        }).catch(error => console.error(`[Background Script] Re-initiated browser download failed: ${url}`, error));
    }
}


// --- WebRequest Listener for intercepting browser downloads ---
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const downloadRelevantTypes = ['main_frame', 'sub_frame', 'other'];

    console.log(details)

    if (!downloadRelevantTypes.includes(details.type)) {
        return { cancel: false };
    }

    let isDownload = false;
    let contentType = null;
    let contentDisposition = null;

    for (const header of details.responseHeaders) {
        const headerName = header.name.toLowerCase();
        if (headerName === 'content-disposition') {
            contentDisposition = header.value;
            if (header.value.toLowerCase().includes('attachment')) {
                isDownload = true;
                break;
            }
        } else if (headerName === 'content-type') {
            contentType = header.value;
        }
    }

    if (!isDownload && contentType) {
        if (contentType.includes('application/octet-stream') ||
            contentType.includes('application/zip') ||
            contentType.includes('application/x-rar-compressed') ||
            contentType.includes('application/x-tar') ||
            contentType.includes('application/gzip') ||
            contentType.includes('application/pdf') ||
            (contentType.startsWith('video/') && details.type === 'main_frame') ||
            (contentType.startsWith('audio/') && details.type === 'main_frame')
           ) {
            if (!contentDisposition || !contentDisposition.toLowerCase().includes('inline')) {
                isDownload = true;
            }
        }
    }

    if (isDownload) {
        console.debug(`[Background Script] Detected potential browser download for: ${details.url}. Tab ID: ${details.tabId}`);
        setTimeout(() => handleInterceptedDownload(details.url, contentType, contentDisposition, details.tabId), 0);
        return { cancel: true };
    }

    return { cancel: false };
  },
  { urls: ["<all_urls>"], types: ['main_frame', 'sub_frame', 'other'] },
  ["blocking", "responseHeaders"]
);


// --- Message Listener from Content Scripts and Popup ---
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "getMediaUrls" && message.tabId !== undefined) {
    const mediaItems = Array.from(scrapedMediaUrls.get(message.tabId) || []);
    console.debug(`[Background Script] Sending media items to popup for tab ${message.tabId}:`, mediaItems);
    sendResponse({ mediaItems: mediaItems });
    return true;
  }
  else if (message.type === "mediaUrlDetected" && sender.tab) {
    addMediaUrl(sender.tab.id, message.url, 'contentScript').catch(error => {
        console.error(`[Background Script] Error adding URL from content script: ${message.url}`, error);
    });
  }
  else if (message.type === "initiateSmartDownload") {
      const { url, filename, tabId } = message;
      console.debug(`[Background Script] Received initiateSmartDownload request for: ${url} as ${filename} (TabId: ${tabId})`);
      handleInterceptedDownload(url, 'application/octet-stream', `attachment; filename="${filename}"`, tabId)
        .then(() => {
            sendResponse({ success: true, message: "Download initiated via smart routing." });
        })
        .catch(error => {
            sendResponse({ success: false, error: error.message, message: "Failed to initiate smart download." });
        });
      return true;
  }
  else if (message.type === "checkLocalhostStatus") {
      console.debug("[Background Script] Received checkLocalhostStatus request.");
      isLocalhostAlive(true)
          .then(alive => {
              sendResponse({ isAlive: alive });
          })
          .catch(error => {
              console.error("[Background Script] Error during checkLocalhostStatus:", error);
              sendResponse({ isAlive: false, error: error.message });
          });
      return true;
  }
  else if (message.type === "portChanged") {
      const newPort = message.newPort;
      nadekoServerPort = newPort;
      console.debug(`[Background Script] Nadeko server port updated to: ${newPort} from options page.`);
      localhostStatusCache.lastChecked = 0;
      sendResponse({ success: true });
      return true;
  }
  else if (message.type === "copyUrl") {
    console.debug(`[Background Script] Received copyUrl message. Clipboard operation is handled in popup.`);
    sendResponse({ success: true, message: "Copy initiated by popup." });
    return true;
  } else if (message.type === "clearUrls") {
      if (message.tabId) {
          scrapedMediaUrls.delete(message.tabId);
          console.debug(`Cleared URLs for tab ${message.tabId}`);
          mediaDetailsCache.clear();
          sendResponse({ success: true });
      } else {
          console.warn("[Background Script] ClearUrls message received without tabId. Clearing all URLs.");
          scrapedMediaUrls.clear();
          mediaDetailsCache.clear();
          sendResponse({ success: false, error: "No tabId provided, all URLs cleared." });
      }
      return true;
  }
});

// --- Tab Listener to clean up URLs when a tab is closed or navigated away ---
browser.tabs.onRemoved.addListener((tabId) => {
    scrapedMediaUrls.delete(tabId);
    console.debug(`Removed URLs for closed tab ${tabId}`);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && scrapedMediaUrls.has(tabId)) {
        scrapedMediaUrls.delete(tabId);
        console.debug(`Cleared URLs for tab ${tabId} due to navigation.`);
        mediaDetailsCache.clear();
    }
});
