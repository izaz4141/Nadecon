// content.js - This script is injected into web pages and handles both media detection and stacking popups

// Define the core CSS for the popups and their container
const popupCss = `
/* Container for all individual popups */
#media-detector-popup-container {
    position: fixed;
    bottom: 12px;
    left: 12px;
    display: flex;
    flex-direction: column-reverse; /* Stacks new popups upwards from the bottom */
    gap: 8px; /* Space between stacked popups */
    z-index: 10000; /* Ensure it's on top of page content */
    pointer-events: none; /* Allow clicks to pass through container to individual popups */
}

/* Styles for each individual media popup item */
.media-detector-popup-item {
    background: #2a2a2e;
    color: white;
    padding: 8px 12px;
    border-radius: 12px;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    gap: 8px;
    border-left: 4px solid #0a84ff;
    font-family: Arial, sans-serif;
    opacity: 0; /* Initial opacity set here in CSS */
    transform: translateY(20px); /* Initial transform set here in CSS */
    transition: opacity 0.5s ease-out, transform 0.5s ease-out; /* Animation transition */
    width: fit-content; /* Adjust width to content */
    min-width: 180px; /* Minimum width for readability */
    /* Removed max-width here to allow inner content to dictate overall width */
    pointer-events: all;
    box-sizing: border-box;
    overflow: visible;
    height: auto;
    min-height: 40px;
}

.media-detector-popup-item.show {
    opacity: 1;
    transform: translateY(0);
}

.media-detector-popup-item .popup-icon {
    font-size: 1rem;
    color: white;
    display: block;
    line-height: 1;
    flex-shrink: 0; /* Prevent icon from shrinking */
}

.media-detector-popup-item .popup-content {
    flex-grow: 1; /* Allow content to take available space */
    display: flex; /* Changed to flex */
    flex-direction: row; /* Changed to row for inline layout */
    align-items: center; /* Align items vertically in the row */
    gap: 8px; /* Space between filename and button */
    height: auto;
    min-height: 30px;
    overflow: visible;
}

.media-detector-popup-item .popup-content p {
    margin: 0;
    font-size: 0.7rem;
    opacity: 0.9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: white;
    visibility: visible;
    line-height: 1.2;
    min-height: 1em;
    max-width: 12ch; /* Limit filename to ~12 characters (ch unit) */
    flex-shrink: 1; /* Allow text to shrink if necessary */
    flex-grow: 0; /* Don't allow text to grow beyond its content or max-width */
}

.media-detector-popup-item .download-btn {
    font-size: 0.7rem; /* Reduced font size */
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.3s;
    padding: 2px 4px; /* Reduced padding */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: unset;
    height: unset;
    text-align: center;
    line-height: 1.2;
    box-sizing: border-box;
    visibility: visible;
    margin-top: 0; /* Reset margin-top for row layout */
    pointer-events: auto;
    flex-shrink: 0; /* Prevent button from shrinking */
}

.media-detector-popup-item .close-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #fff;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.3s;
    font-size: 0.8rem;
    line-height: 1;
    flex-shrink: 0; /* Prevent button from shrinking */
    box-sizing: border-box;
    visibility: visible;
    pointer-events: auto;
}

.media-detector-popup-item .download-btn:hover,
.media-detector-popup-item .close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
}

.media-detector-popup-item .download-btn.error {
    background: #ff0039;
    animation: shake 0.5s;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-5px); }
    40%, 80% { transform: translateX(5px); }
}
`;

// Inject styles using adoptedStyleSheets if available (more robust against webpage CSS)
if (document.adoptedStyleSheets && CSSStyleSheet) {
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(popupCss);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        console.debug("[Content Script] Styles injected using adoptedStyleSheets.");
    } catch (e) {
        console.warn("[Content Script] adoptedStyleSheets failed, falling back to <style> tag:", e);
        const styleElement = document.createElement('style');
        styleElement.textContent = popupCss;
        document.head.appendChild(styleElement);
        console.debug("[Content Script] Styles injected using <style> tag.");
    }
} else {
    // Fallback for older browsers or environments without adoptedStyleSheets
    const styleElement = document.createElement('style');
    styleElement.textContent = popupCss;
    document.head.appendChild(styleElement);
    console.debug("[Content Script] Styles injected using <style> tag.");
}


// Ensure the popup container exists and is added to the DOM
let popupContainer = document.getElementById('media-detector-popup-container');
if (!popupContainer) {
    popupContainer = document.createElement('div');
    popupContainer.id = 'media-detector-popup-container';
    document.body.appendChild(popupContainer);
    console.debug("[Content Script] Created and appended #media-detector-popup-container to body.");
} else {
    console.debug("[Content Script] #media-detector-popup-container already exists.");
}


// A Set to keep track of URLs for which popups are currently active, to prevent exact duplicates
const activePopupUrls = new Set();
const processedUrls = new Set(); // To keep track of URLs already processed for DOM elements

/**
 * Handles errors during the download process (e.g., app not running).
 * @param {HTMLElement} downloadButton - The download button element.
 * @param {HTMLElement} popupElement - The individual popup div element.
 * @param {string} url - The URL associated with this popup.
 */
function handleDownloadError(downloadButton, popupElement, url) {
    downloadButton.textContent = '✗ Failed! Connecting with App';
    downloadButton.style.background = '#ff0039';
    downloadButton.classList.add('error');
    downloadButton.disabled = false;

    if (downloadButton._retryHandler) {
        downloadButton.removeEventListener('click', downloadButton._retryHandler);
    }

    const newHandler = () => {
        downloadButton.textContent = 'Sending...';
        downloadButton.style.background = 'rgba(255, 255, 255, 0.1)';
        downloadButton.classList.remove('error');
        downloadButton.disabled = true;

        browser.runtime.sendMessage({
            type: 'initiateSmartDownload',
            url: url,
            filename: popupElement.querySelector('p').textContent
        }).then(response => {
            if (response && response.success) {
                downloadButton.textContent = '✓ URL Sent!';
                downloadButton.style.background = '#30e60b';
                setTimeout(() => { popupElement.remove(); activePopupUrls.delete(url); }, 1500);
            } else {
                console.error(`[Content Script] Background script reported error for ${url}: ${response.error}`);
                handleDownloadError(downloadButton, popupElement, url);
            }
        }).catch(error => {
            console.error(`[Content Script] Error sending message to background for ${url}:`, error);
            handleDownloadError(downloadButton, popupElement, url);
        });
    };
    downloadButton.addEventListener('click', newHandler);
    downloadButton._retryHandler = newHandler;

    setTimeout(() => {
        if (popupElement.isConnected && downloadButton.classList.contains('error')) {
            downloadButton.textContent = 'Download'; // Revert to 'Download' on timeout
            downloadButton.style.background = 'rgba(255, 255, 255, 0.1)';
            downloadButton.classList.remove('error');
            downloadButton.disabled = false;
        }
    }, 5000);
}

/**
 * Displays an individual media download popup.
 * @param {object} mediaItem - The media item object ({url, filename})
 */
function showMediaDownloadPopup(mediaItem) {
    const { url, filename } = mediaItem;

    console.debug(`[Content Script] showMediaDownloadPopup called for: ${filename} (${url}).`);

    if (activePopupUrls.has(url)) {
        console.debug(`[Content Script] Popup for ${url} is already active. Skipping creation.`);
        return;
    }

    console.debug(`[Content Script] Creating new media download popup for: ${filename} (${url})`);
    
    const popup = document.createElement('div');
    popup.className = 'media-detector-popup-item';

    let icon = '🔗';
    const extMatch = filename.match(/\.([a-z0-9]+)$/i);
    const extension = extMatch ? extMatch[1].toLowerCase() : '';

    if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'ts', 'm3u8', 'mpd'].includes(extension)) {
        icon = '🎬';
    } else if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(extension)) {
        icon = '🔊';
    } else if (['gif', 'jpg', 'jpeg', 'png', 'webp', 'svg'].includes(extension)) {
        icon = '🖼️';
    }

    popup.innerHTML = `
        <div class="popup-icon">${icon}</div>
        <div class="popup-content">
            <p title="${filename}">${filename.length > 12 ? filename.substring(0, 12) + '...' : filename}</p>
            <button class="download-btn">Download</button>
        </div>
        <button class="close-btn">✕</button>
    `;

    popupContainer.appendChild(popup);
    activePopupUrls.add(url);

    console.debug(`[Content Script] Popup element appended to container for ${url}.`);

    setTimeout(() => {
        if (popup.isConnected) {
            popup.classList.add('show');
            console.debug(`[Content Script] Popup class 'show' added for ${url}. Popup is connected.`);
        } else {
            console.debug(`[Content Script] Popup for ${url} was NOT connected when trying to add 'show' class.`);
        }
    }, 50);

    popup.querySelector('.close-btn').addEventListener('click', () => {
        console.debug(`[Content Script] Popup closed by user for ${url}.`);
        popup.remove();
        activePopupUrls.delete(url);
    });

    const downloadButton = popup.querySelector('.download-btn');
    downloadButton.addEventListener('click', () => {
        downloadButton.disabled = true;
        downloadButton.textContent = 'Sending...';

        browser.runtime.sendMessage({
            type: 'initiateSmartDownload',
            url: url,
            filename: filename
        }).then(response => {
            if (response && response.success) {
                downloadButton.textContent = '✓ URL Sent!';
                downloadButton.style.background = '#30e60b';
                console.debug(`[Content Script] Successfully sent URL to background: ${url}`);
                setTimeout(() => { popup.remove(); activePopupUrls.delete(url); }, 1500);
            } else {
                console.error(`[Content Script] Background script reported error for ${url}: ${response.error}`);
                handleDownloadError(downloadButton, popup, url);
            }
        }).catch(error => {
            console.error(`[Content Script] Error sending message to background for ${url}:`, error);
            handleDownloadError(downloadButton, popup, url);
        });
    });
}

/**
 * Processes a given HTML element to extract potential media URLs.
 * Sends valid, unique URLs to the background script.
 * @param {Element} element - The HTML element to check.
 */
const processMediaElement = (element) => {
  let mediaUrl = '';
  const tagName = element.tagName;

  if (tagName === 'VIDEO' || tagName === 'AUDIO') {
    mediaUrl = element.src || element.currentSrc;
  } else if (tagName === 'IFRAME' || tagName === 'EMBED' || tagName === 'OBJECT') {
    mediaUrl = element.src || element.data;
  } else if (tagName === 'SOURCE') {
    mediaUrl = element.src;
  }

  if (mediaUrl && !mediaUrl.startsWith('blob:') && !mediaUrl.startsWith('data:') && !processedUrls.has(mediaUrl)) {
    console.debug("[Content Script] Discovered potential media URL from DOM:", mediaUrl);
    processedUrls.add(mediaUrl);
    browser.runtime.sendMessage({ type: "mediaUrlDetected", url: mediaUrl })
      .catch(error => {
        console.warn("[Content Script] Failed to send 'mediaUrlDetected' message to background:", error);
      });
  }
};

/**
 * Callback function for MutationObserver.
 * Iterates through added nodes and processes them for media URLs.
 * @param {MutationRecord[]} mutationList - List of mutations observed.
 * @param {MutationObserver} observer - The observer instance.
 */
const mutationCallback = (mutationList, observer) => {
  for (const mutation of mutationList) {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processMediaElement(node);
          const mediaElementsInSubtree = node.querySelectorAll('video, audio, iframe, embed, source, object');
          mediaElementsInSubtree.forEach(processMediaElement);
        }
      });
    }
  }
};

const observer = new MutationObserver(mutationCallback);
const targetNode = document.body;
const config = { childList: true, subtree: true };

if (targetNode) {
    observer.observe(targetNode, config);
    console.debug("[Content Script] MutationObserver started.");
} else {
    console.warn("[Content Script] Document body not found, MutationObserver could not be started.");
}


document.querySelectorAll('video, audio, iframe, embed, source, object')
   .forEach(processMediaElement);

console.debug("[Content Script] Initial DOM scan complete.");

browser.runtime.onMessage.addListener((message) => {
    console.debug(`[Content Script] Received message from background: Type = ${message.type}`, message);

    if (message.type === "showMediaPopup" && message.mediaItem) {
        showMediaDownloadPopup(message.mediaItem);
    }
    if (message.type === "stopObserving") {
        observer.disconnect();
        console.debug("[Content Script] MutationObserver disconnected as requested by background.");
    }
    if (message.type === "closeAllPopups") {
        console.debug("[Content Script] Received closeAllPopups message. Clearing all popups.");
        const allPopups = document.querySelectorAll('.media-detector-popup-item');
        allPopups.forEach(popup => {
            popup.remove();
        });
        activePopupUrls.clear(); // Clear the set of active URLs
    }
});

console.debug("[Content Script] Media Detector content script loaded.");
