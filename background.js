// background.js

let nadekoServerPort = 12345; // Default port

// Cache for localhost availability to reduce repeated checks.
const localhostStatusCache = {
    isAlive: false,
    lastChecked: 0,
    checkInterval: 5000 // Cache for 5 seconds
};

// Threshold for considering a video/audio file a "fragment" based on Content-Length (2 MB)
const FRAGMENT_SIZE_THRESHOLD_BYTES = 2 * 1024 * 1024; 

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
// Structure: Map<tabId, Map<url, {url, filename, validMedia, isManifest, isFragment}>>
const scrapedMediaUrls = new Map();

// Cache for fetchMediaHeaders results.
const mediaDetailsCache = new Map();

/**
 * Performs a HEAD request to get Content-Type, Content-Disposition, and Content-Length headers.
 * @param {string} url - The URL to check.
 * @returns {Promise<{valid: boolean, contentType: string | null, contentDisposition: string | null, contentLength: number | null}>}
 */
async function fetchMediaHeaders(url) {
    if (mediaDetailsCache.has(url)) {
        return mediaDetailsCache.get(url);
    }

    const promise = (async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2-second timeout for HEAD request

            const response = await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            clearTimeout(timeoutId);
            
            // For 'no-cors' requests, response.ok is always false if it's cross-origin,
            // so we primarily rely on response.type === 'opaque'.
            // If the request itself failed (e.g., network error, DNS, or CORS/CORP block),
            // it will throw an error or be of type 'error'.
            if (response.type === 'error') { // Explicitly check for 'error' type
                console.warn(`[Background Script] HEAD request for ${url} resulted in a network error.`);
                return { valid: false, contentType: null, contentDisposition: null, contentLength: null };
            }

            const contentType = response.headers.get('Content-Type');
            const contentDisposition = response.headers.get('Content-Disposition');
            const contentLengthHeader = response.headers.get('Content-Length');
            const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

            // Explicitly check for known media and streaming types
            const isMedia = contentType && (
                contentType.startsWith('video/') ||
                contentType.startsWith('audio/') ||
                contentType.startsWith('image/gif') ||
                contentType.includes('mpegurl') || // HLS
                contentType.includes('dash+xml') || // DASH
                contentType.includes('application/octet-stream') // Generic binary, might be media
            );

            return { valid: isMedia, contentType, contentDisposition, contentLength };
        } catch (error) {
            // This catch block handles actual fetch API errors (e.g., AbortError from timeout, network issues)
            console.warn(`[Background Script] Failed to fetch headers for ${url} (caught error): ${error.message}`);
            return { valid: false, contentType: null, contentDisposition: null, contentLength: null };
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
            if (fileExtension === 'octet-stream' && (url.includes('.bin') || url.includes('.dat'))) fileExtension = 'bin'; // Added .dat
            if (fileExtension === 'octet-stream' && url.includes('.ts')) fileExtension = 'ts';
            if (fileExtension === 'mp4a-latm') fileExtension = 'aac';
        }
    }

    const currentExt = filename.includes('.') ? filename.split('.').pop() : '';

    if (fileExtension && currentExt.toLowerCase() !== fileExtension) {
        const mediaExtensions = ['mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'avi', 'mov', 'mkv', 'wmv', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp', 'm3u8', 'mpd', 'ts', 'bin', 'dat']; // Added .dat
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
 * Gets full media details (validity, content type, derived filename, isManifest flag, isFragment flag) for a given URL.
 * @param {string} url - The URL of the potential media.
 * @returns {Promise<{url: string, filename: string, validMedia: boolean, isManifest: boolean, isFragment: boolean}>}
 */
async function getMediaDetails(url) {
    const { valid, contentType, contentDisposition, contentLength } = await fetchMediaHeaders(url);
    const filename = deriveFilename(url, contentType, contentDisposition);

    const isManifest = contentType && (contentType.includes('mpegurl') || contentType.includes('dash+xml'));

    // A URL is considered a fragment if it's video/audio and its size is below a threshold, AND it's not a manifest
    const isFragment = (contentType && (contentType.startsWith('video/') || contentType.startsWith('audio/'))) && 
                       (contentLength !== null && contentLength < FRAGMENT_SIZE_THRESHOLD_BYTES) &&
                       !isManifest; // Ensure manifests themselves aren't marked as fragments by size alone

    return { url, filename, validMedia: valid, isManifest: isManifest, isFragment: isFragment };
}


/**
 * Adds a URL (along with its derived filename and manifest status) to the scrapedMediaUrls set for a specific tab.
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

  // IMPORTANT FILTERING LOGIC: Do not add fragments unless they are also manifests
  if (mediaItem.isFragment && !mediaItem.isManifest) {
      console.debug(`[Background Script] Skipping fragment URL for tab ${tabId}: ${mediaItem.filename} (${mediaItem.url}) (Type: General Media, but fragment)`);
      return; 
  }

  if (!scrapedMediaUrls.has(tabId)) {
    scrapedMediaUrls.set(tabId, new Map()); // Use a Map for media items per tab, keyed by URL
  }
  const urlsForTab = scrapedMediaUrls.get(tabId);

  // Check if exact URL already exists to prevent true duplicates
  if (urlsForTab.has(mediaItem.url)) {
      console.debug(`[Background Script] URL ${mediaItem.url} already exists for tab ${tabId}. Skipping.`);
      return;
  }

  // Add the new media item to the tab's map
  urlsForTab.set(mediaItem.url, mediaItem);

  let logMessage = `[Background Script] Added media item for tab ${tabId} (${source}): ${mediaItem.filename} (${mediaItem.url})`;
  if (mediaItem.isManifest) {
      logMessage += " (Type: Manifest)";
  } else {
      logMessage += " (Type: General Media)"; // Will only be 'General Media' for full files after fragment filter
  }
  console.debug(logMessage);
    
  // Notify the main browser action popup to update its list
  browser.runtime.sendMessage({ type: "urlAdded", mediaItem: mediaItem, tabId: tabId }).catch(error => {
      // This is fine if the popup isn't open
  });

  // Only send message to content script if tabId is valid (>= 0)
  if (tabId >= 0) {
      // Send message to content script for popup display
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

/**
 * Checks if an XHR URL is likely related to media, based on its path and query parameters.
 * This is a heuristic to reduce unnecessary HEAD requests.
 * @param {string} url - The XHR URL to check.
 * @returns {boolean} - True if the URL is likely a media stream/manifest/segment.
 */
function isLikelyMediaXHR(url) {
    // 1. **Prioritize explicit exclusions for known non-media internal APIs**
    // These are often internal Facebook API endpoints that are NOT media.
    if (url.includes('facebook.com') || url.includes('fbcdn.net')) {
        if (url.includes('/ajax/') || url.includes('bootloader-endpoint') || url.includes('graphql')) {
            console.debug(`[Background Script] Skipping known Facebook internal API URL: ${url}`);
            return false;
        }
    }

    // 2. **Check for media-specific extensions and patterns**
    const mediaExtensions = /\.(m3u8|mpd|ts|aac|mp4|webm|m4s|mp4a|vtt|f4m|ism|isml|dash|json|bin|dat|fmp4)(\?.*)?$/i;
    const streamingPatterns = /(chunk|segment|playlist|manifest|stream|video|audio|hls|dash|drm|playable_url|video_play|stream_src)/i;

    if (mediaExtensions.test(url) || streamingPatterns.test(url)) {
        return true;
    }

    // 3. **Broad domain checks (after more specific checks)**
    // These are domains frequently associated with media.
    const knownMediaDomains = /(youtube\.com|vimeo\.com|cdn\.videoplatform\.com|akamaihd\.net|cloudfront\.net|mediaservices\.windows\.net|video\.twimg\.com|cdninstagram\.com|v\.redd\.it)/i;
    if (knownMediaDomains.test(url)) {
        return true;
    }

    // 4. **Heuristic for JSON responses that might contain media URLs**
    // This is still a heuristic; actual JSON parsing for embedded URLs would be a separate step.
    if (url.includes('.json') && (url.includes('video_play') || url.includes('stream_src') || url.includes('playable_url'))) {
        return true;
    }

    return false; // If none of the above criteria are met, it's not likely media
}

// --- WebRequest Listener for detecting media and general downloads ---
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    // 'media' for direct video/audio elements, 'object' for embeds, 'sub_frame' for embedded players (YouTube, Vimeo)
    // 'xmlhttprequest' is critical for detecting dynamically loaded content and streaming manifests.
    const relevantResourceTypes = ['media', 'object', 'sub_frame', 'xmlhttprequest'];

    if (relevantResourceTypes.includes(details.type)) {
        // For sub_frames, specifically target known video embeds (if they are not already handled by general XHR)
        if (details.type === 'sub_frame') {
            if (details.url.includes('youtube.com/embed/') || details.url.includes('vimeo.com/video/')) {
                addMediaUrl(details.tabId, details.url, 'webRequest');
            }
        } else if (details.type === 'xmlhttprequest') { // Corrected the typo 'xmlhtthttprequest'
            // Only process XHRs that are likely media or streaming manifests based on URL patterns
            if (isLikelyMediaXHR(details.url)) {
                addMediaUrl(details.tabId, details.url, 'webRequest').catch(error => {
                    console.error(`[Background Script] Error adding URL from XHR webRequest: ${details.url}`, error);
                });
            }
        } else { // 'media', 'object'
            // For direct media and object embeds, add them directly
            addMediaUrl(details.tabId, details.url, 'webRequest').catch(error => {
              console.error(`[Background Script] Error adding URL from webRequest: ${details.url}`, error);
            });
        }
    }
  },
  // Listen for these types across all URLs
  { urls: ["<all_urls>"], types: ['media', 'object', 'sub_frame', 'xmlhttprequest'] },
  ["blocking"] // 'blocking' to allow modification/cancellation if needed later, currently not used for cancellation
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
    // Only intercept downloads from main frame, sub frames, or 'other' (which can include background downloads)
    const downloadRelevantTypes = ['main_frame', 'sub_frame', 'other'];

    // console.log(details) // Useful for debugging what requests come through here

    if (!downloadRelevantTypes.includes(details.type)) {
        return { cancel: false };
    }

    let isDownload = false;
    let contentType = null;
    let contentDisposition = null;
    let contentLength = null; // Get content length if available

    for (const header of details.responseHeaders) {
        const headerName = header.name.toLowerCase();
        if (headerName === 'content-disposition') {
            contentDisposition = header.value;
            if (header.value.toLowerCase().includes('attachment')) {
                isDownload = true; // Force download if content-disposition is attachment
                // We don't break here, in case content-type is also needed
            }
        } else if (headerName === 'content-type') {
            contentType = header.value;
        } else if (headerName === 'content-length') {
            contentLength = parseInt(header.value, 10);
        }
    }

    // Heuristic for making something a download even if content-disposition isn't 'attachment'
    if (!isDownload && contentType) {
        // List of common downloadable file types
        const downloadableContentTypes = [
            'application/octet-stream', 'application/zip', 'application/x-rar-compressed',
            'application/x-tar', 'application/gzip', 'application/pdf',
            // Also consider direct video/audio loads in main frame as potential downloads
            // if they are not explicitly inline.
        ];

        if (downloadableContentTypes.includes(contentType.toLowerCase())) {
            if (!contentDisposition || !contentDisposition.toLowerCase().includes('inline')) {
                isDownload = true;
            }
        } else if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
            // If it's a video/audio content type and it's being loaded in the main frame
            // AND not explicitly inline, treat as potential download.
            // This is typically how fragmented pieces get loaded.
            if (details.type === 'main_frame' && (!contentDisposition || !contentDisposition.toLowerCase().includes('inline'))) {
                // If it's a video/audio in main frame and it's small, it's likely a fragment.
                // We now have `contentLength` to help with this heuristic.
                if (contentLength !== null && contentLength < FRAGMENT_SIZE_THRESHOLD_BYTES) {
                    // Do NOT treat as a browser download if it's a small fragment
                    // The idea is to let Nadeko handle the manifests.
                    // This is a subtle point: if a fragment IS somehow triggered as a download,
                    // we still want to pass it to Nadeko if Nadeko is alive, but not
                    // fall back to browser.downloads.download if it's a fragment.
                    // For now, let's keep `isDownload = true` here so it goes to handleInterceptedDownload.
                    // The `handleInterceptedDownload` will then determine if it's sent to Nadeko.
                     isDownload = true;
                } else {
                    isDownload = true; // Treat as download if large video/audio in main frame
                }
            }
        }
        // Explicitly handle manifest types if they somehow trigger a download, though rare
        else if (contentType.includes('mpegurl') || contentType.includes('dash+xml')) {
            isDownload = true; // If a manifest itself is downloaded, treat it as a download
        }
    }

    if (isDownload) {
        console.debug(`[Background Script] Detected potential browser download for: ${details.url}. Tab ID: ${details.tabId} (Content-Type: ${contentType || 'N/A'}, Content-Disposition: ${contentDisposition || 'N/A'}, Length: ${contentLength !== null ? contentLength : 'N/A'})`);
        // Use a timeout to ensure `isLocalhostAlive` doesn't block the web request handling loop
        setTimeout(() => handleInterceptedDownload(details.url, contentType, contentDisposition, details.tabId), 0);
        return { cancel: true }; // Cancel the browser's default download action
    }

    return { cancel: false }; // Let the browser handle the request normally
  },
  // Listen for responses from all URLs for these types
  { urls: ["<all_urls>"], types: ['main_frame', 'sub_frame', 'other'] },
  // 'responseHeaders' to access headers, 'blocking' to cancel the default action
  ["blocking", "responseHeaders"]
);


// --- Message Listener from Content Scripts and Popup ---
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "getMediaUrls" && message.tabId !== undefined) {
    // Convert Map values to an Array for the popup
    const mediaItems = Array.from(scrapedMediaUrls.get(message.tabId)?.values() || []);
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
      // When initiateSmartDownload is triggered, it's explicitly by user intent
      // so we assume it's a valid target and send it.
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
      localhostStatusCache.lastChecked = 0; // Clear cache so new port is checked
      sendResponse({ success: true });
      return true;
  }
  else if (message.type === "copyUrl") {
    console.debug(`[Background Script] Received copyUrl message. Clipboard operation is handled in popup.`);
    sendResponse({ success: true, message: "Copy initiated by popup." });
    return true;
  } else if (message.type === "clearUrls") {
      // Clear specific tab URLs or all URLs
      if (message.tabId) {
          scrapedMediaUrls.delete(message.tabId); // Clear map for this tab
          console.debug(`Cleared URLs for tab ${message.tabId}`);
          browser.tabs.sendMessage(message.tabId, { type: "closeAllPopups" }).catch(error => {
              console.warn(`[Background Script] Could not send closeAllPopups to tab ${message.tabId}:`, error);
          });
          sendResponse({ success: true });
      } else {
          console.warn("[Background Script] ClearUrls message received without tabId. Clearing all URLs across all tabs.");
          scrapedMediaUrls.clear(); // Clear all tabs' URLs
          mediaDetailsCache.clear(); // Clear global cache for all URLs

          // Send message to all active content scripts to close popups
          browser.tabs.query({}).then(tabs => {
              tabs.forEach(tab => {
                  if (tab.id !== undefined) {
                      browser.tabs.sendMessage(tab.id, { type: "closeAllPopups" }).catch(error => {
                          console.warn(`[Background Script] Could not send closeAllPopups to tab ${tab.id}:`, error);
                      });
                  }
              });
          });
          sendResponse({ success: false, error: "No tabId provided, all URLs and popups cleared." });
      }
      return true;
  }
});

// --- Tab Listener to clean up URLs when a tab is closed or navigated away ---
browser.tabs.onRemoved.addListener((tabId) => {
    scrapedMediaUrls.delete(tabId); // Remove entries for the closed tab
    console.debug(`Removed URLs for closed tab ${tabId}`);
    // No need to clear mediaDetailsCache here, it's global and can benefit other tabs.
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Clear URLs for a tab if it navigates to a new main URL
    if (changeInfo.url && scrapedMediaUrls.has(tabId)) {
        scrapedMediaUrls.delete(tabId);
        console.debug(`Cleared URLs for tab ${tabId} due to navigation.`);
        // No need to clear mediaDetailsCache here.
        // When a tab navigates, its content script reloads, so old popups are naturally cleared.
        // No explicit 'closeAllPopups' message needed here as the content script is re-injected.
    }
});
