// window/main.js

const urlListDiv = document.getElementById('urlList');
const noUrlsMessage = document.getElementById('noUrlsMessage');
const messageBox = document.getElementById('messageBox');
const clearUrlsBtn = document.getElementById('clearUrlsBtn');
const serverStatusText = document.getElementById('serverStatusText');
const serverStatusReloadBtn = document.getElementById('serverStatusReloadBtn');
const configBtn = document.getElementById('configBtn');

let currentTabId = null;

/**
 * Displays a temporary message in the message box.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', 'info' (optional, for styling)
 */
function showMessageBox(message, type = 'info') {
    messageBox.textContent = message;
    messageBox.className = `fixed bottom-4 left-1/2 -translate-x-1/2 p-2 text-sm rounded-lg shadow-lg transition-opacity duration-300 ease-out opacity-0`;

    if (type === 'success') {
        messageBox.classList.add('bg-green-600', 'text-white');
    } else if (type === 'error') {
        messageBox.classList.add('bg-red-600', 'text-white');
    } else {
        messageBox.classList.add('bg-gray-800', 'text-white');
    }

    messageBox.classList.remove('hidden');
    void messageBox.offsetWidth;
    messageBox.classList.remove('opacity-0');
    messageBox.classList.add('opacity-100');

    setTimeout(() => {
        messageBox.classList.remove('opacity-100');
        messageBox.classList.add('opacity-0');
        setTimeout(() => {
            messageBox.classList.add('hidden');
        }, 300);
    }, 2000);
}

/**
 * Creates and appends a media item (filename + buttons) to the list in the popup.
 * @param {{url: string, filename: string}} mediaItem - The media item object to display.
 */
function addUrlToPopup(mediaItem) {
    const { url, filename } = mediaItem;
    console.debug(`[Popup] Attempting to add media item to UI: ${filename} (${url})`);
    noUrlsMessage.classList.add('hidden');

    const existingUrlElements = urlListDiv.querySelectorAll('.url-item-text');
    for (const span of existingUrlElements) {
        if (span.dataset.originalUrl === url) {
            console.debug(`[Popup] URL already displayed: ${url}. Skipping.`);
            return;
        }
    }

    const urlItem = document.createElement('div');
    urlItem.className = 'bg-white p-3 rounded-lg shadow-sm flex items-center justify-between text-sm break-all';
    urlItem.innerHTML = `
        <div class="flex-grow pr-2">
            <span class="url-item-text block line-clamp-2" data-original-url="${url}">${filename}</span>
        </div>
        <div class="flex-shrink-0 flex space-x-2">
            <button class="copy-btn bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-2 rounded-md transition duration-150 ease-in-out">Copy</button>
            <button class="download-btn bg-green-500 hover:bg-green-600 text-white font-semibold py-1 px-2 rounded-md transition duration-150 ease-in-out">Download</button>
        </div>
    `;

    urlItem.querySelector('.copy-btn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url);
            showMessageBox('URL copied to clipboard!', 'success');
            console.debug(`[Popup] Copied URL to clipboard: ${url}`);
        } catch (err) {
            showMessageBox('Failed to copy URL.', 'error');
            console.error(`[Popup] Error copying to clipboard: ${err}`);
        }
    });

    urlItem.querySelector('.download-btn').addEventListener('click', () => {
        console.debug(`[Popup] Sending initiateSmartDownload request for URL: ${url}, Filename: ${filename}`);
        browser.runtime.sendMessage({ type: "initiateSmartDownload", url: url, filename: filename, tabId: currentTabId })
            .then(response => {
                if (response.success) {
                    showMessageBox('Download initiated!', 'success');
                } else {
                    showMessageBox(`Download failed: ${response.error || 'Unknown error'}`, 'error');
                }
            })
            .catch(error => showMessageBox(`Error initiating smart download: ${error.message}`, 'error'));
    });

    urlListDiv.appendChild(urlItem);
    console.debug(`[Popup] Successfully added media item to UI: ${filename}`);
}

/**
 * Function to refresh the URL list in the popup.
 * @param {{url: string, filename: string}[]} mediaItems - Array of media item objects.
 */
function refreshUrlList(mediaItems) {
    console.debug(`[Popup] Refreshing URL list with ${mediaItems.length} media items.`);
    urlListDiv.innerHTML = '';
    if (mediaItems && mediaItems.length > 0) {
        mediaItems.forEach(item => addUrlToPopup(item));
        noUrlsMessage.classList.add('hidden');
        console.debug("[Popup] Hiding 'No URLs found' message.");
    } else {
        noUrlsMessage.classList.remove('hidden');
        console.debug("[Popup] Showing 'No URLs found' message.");
    }
}

/**
 * Updates the server status indicator text and color.
 * @param {boolean | null} isAlive - true if alive, false if not, null if checking.
 */
function updateServerStatusIndicator(isAlive) {
    serverStatusText.classList.remove('text-green-600', 'text-red-600', 'text-gray-600');
    if (isAlive === true) {
        serverStatusText.textContent = 'Nadeko Connection: Alive';
        serverStatusText.classList.add('text-green-600');
        console.debug("[Popup] Server status: Alive.");
    } else if (isAlive === false) {
        serverStatusText.textContent = 'Nadeko Connection: Not Alive';
        serverStatusText.classList.add('text-red-600');
        console.debug("[Popup] Server status: Not Alive.");
    } else {
        serverStatusText.textContent = 'Checking connection status...';
        serverStatusText.classList.add('text-gray-600');
        console.debug("[Popup] Server status: Checking...");
    }
}

/**
 * Initiates a check for the Nadeko server's liveness.
 */
async function checkServerStatus() {
    updateServerStatusIndicator(null);
    try {
        const response = await browser.runtime.sendMessage({ type: "checkLocalhostStatus" });
        if (response && typeof response.isAlive === 'boolean') {
            updateServerStatusIndicator(response.isAlive);
        } else {
            updateServerStatusIndicator(false);
            console.warn("[Popup] Malformed response from checkLocalhostStatus:", response);
        }
    } catch (error) {
        updateServerStatusIndicator(false);
        console.error("[Popup] Error checking server status:", error);
    }
}


// --- Event Listeners ---

browser.runtime.onMessage.addListener((message) => {
    console.debug(`[Popup] Message received from background:`, message);
    if (message.type === "urlAdded" && message.tabId === currentTabId && message.mediaItem) {
        addUrlToPopup(message.mediaItem);
        console.debug(`[Popup] New media item received and added: ${message.mediaItem.filename}`);
    } else if (message.type === "clearUrlsDisplay" && message.tabId === currentTabId) {
        refreshUrlList([]);
        console.debug(`[Popup] Display cleared for tab ${currentTabId}`);
    } else if (message.type === "downloadHandledByNadeko" && message.tabId === currentTabId) {
        showMessageBox(`Sent ${message.filename} to Nadeko!`, 'success');
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    console.debug("[Popup] DOMContentLoaded event fired. Initializing popup.");
    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            currentTabId = tabs[0].id;
            console.debug(`[Popup] Current active tab ID: ${currentTabId}`);
            console.debug(`[Popup] Requesting media items for tab ID: ${currentTabId}...`);

            const response = await browser.runtime.sendMessage({ type: "getMediaUrls", tabId: currentTabId });
            console.debug("[Popup] Response from getMediaUrls:", response);

            if (response && response.mediaItems) {
                refreshUrlList(response.mediaItems);
            } else {
                noUrlsMessage.classList.remove('hidden');
                console.warn("[Popup] No media items received or response was malformed. Showing 'No URLs found' message.");
            }

            checkServerStatus(); // Initial check for server status

        } else {
            console.warn("[Popup] No active tab found. Showing 'No URLs found' message.");
            noUrlsMessage.textContent = "Please ensure a tab is active. No media URLs found yet.";
            noUrlsMessage.classList.remove('hidden');
        }
    } catch (error) {
        console.error("[Popup] Error initializing popup:", error);
        noUrlsMessage.textContent = `Error loading URLs: ${error.message}`;
        noUrlsMessage.classList.remove('hidden');
        console.debug("[Popup] Showing 'No URLs found' message due to initialization error.");
    }
});

clearUrlsBtn.addEventListener('click', async () => {
    console.debug(`[Popup] Clear URLs button clicked. currentTabId: ${currentTabId}`);
    if (currentTabId) {
        try {
            const response = await browser.runtime.sendMessage({ type: "clearUrls", tabId: currentTabId });
            if (response && response.success) {
                refreshUrlList([]);
                showMessageBox('URLs cleared for this tab.', 'info');
                console.debug(`[Popup] Sent clearUrls message for tab ${currentTabId}.`);
            } else {
                showMessageBox(`Failed to clear URLs: ${response?.error || 'Unknown error'}`, 'error');
                console.error(`[Popup] Failed to clear URLs for tab ${currentTabId}:`, response);
            }
        } catch (error) {
            showMessageBox(`Error clearing URLs: ${error.message}`, 'error');
            console.error(`[Popup] Error sending clearUrls message for tab ${currentTabId}:`, error);
        }
    } else {
        showMessageBox('No active tab to clear URLs for.', 'info');
    }
});

serverStatusReloadBtn.addEventListener('click', checkServerStatus);

// New: Listener for the configuration button to open a new popup window
configBtn.addEventListener('click', () => {
    browser.windows.create({
        url: browser.runtime.getURL("config/config.html"),
        type: "popup", // Opens as a small, floating window
        width: 450, // Adjust size as needed
        height: 350,
        left: 100, // Optional: position it
        top: 100
    }).catch(error => {
        console.error("[Popup] Failed to open config window:", error);
        showMessageBox("Failed to open configuration window.", "error");
    });
});
