// config/config.js

const serverPortInput = document.getElementById('serverPort');
const showPopupCheckbox = document.getElementById('showPopup');

const saveBtn = document.getElementById('saveBtn');
const statusMessage = document.getElementById('statusMessage');
const portError = document.getElementById('portError');

const DEFAULT_PORT = 12345;
const DEFAULT_SHOW = true

/**
 * Displays a temporary status message to the user.
 * @param {string} message - The message to display.
 * @param {string} type - 'success' or 'error'.
 */
function showStatusMessage(message, type) {
    statusMessage.textContent = message;
    statusMessage.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'bg-red-100', 'text-red-700');
    if (type === 'success') {
        statusMessage.classList.add('bg-green-100', 'text-green-700');
    } else {
        statusMessage.classList.add('bg-red-100', 'text-red-700');
    }
    statusMessage.classList.remove('opacity-0');
    statusMessage.classList.add('opacity-100');

    setTimeout(() => {
        statusMessage.classList.remove('opacity-100');
        statusMessage.classList.add('opacity-0');
        setTimeout(() => {
            statusMessage.classList.add('hidden');
        }, 300);
    }, 2000);
}

/**
 * Loads the saved port from storage and populates the input field.
 */
async function loadOptions() {
    try {
        const result = await browser.storage.local.get('nadekoPort');
        serverPortInput.value = result.nadekoPort || DEFAULT_PORT;
        const checkedValue = await browser.storage.local.get('showPopup');
        showPopupCheckbox.checked = checkedValue.showPopup === 'true' ? true : (checkedValue.showPopup === 'false' ? false : DEFAULT_SHOW);
    } catch (error) {
        console.error('[Config] Error loading options:', error);
        serverPortInput.value = DEFAULT_PORT;
        showStatusMessage('Error loading settings.', 'error');
    }
}

/**
 * Saves the port from the input field to storage.
 */
async function saveOptions() {
    portError.classList.add('hidden');
    const port = parseInt(serverPortInput.value, 10);
    const isChecked = showPopupCheckbox.checked.toString();

    if (isNaN(port) || port < 1 || port > 65535) {
        portError.classList.remove('hidden');
        showStatusMessage('Invalid port number.', 'error');
        return;
    }

    try {
        await browser.storage.local.set({ nadekoPort: port });
        await browser.storage.local.set({ showPopup: isChecked })

        console.debug(`[Config[ Succesfully set port to ${port} and show to ${isChecked}`)
        showStatusMessage('Settings saved successfully!', 'success');

        // Notify background script of port change to refresh cache immediately
        browser.runtime.sendMessage({ type: "settingChanged", newPort: port, showChecked: isChecked }).catch(e => {
            console.warn("[Config] Could not notify background script of port change:", e);
        });

    } catch (error) {
        console.error('[Config] Error saving options:', error);
        showStatusMessage('Error saving settings.', 'error');
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', loadOptions);
saveBtn.addEventListener('click', saveOptions);

// Real-time validation feedback (optional)
serverPortInput.addEventListener('input', () => {
    const port = parseInt(serverPortInput.value, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        portError.classList.remove('hidden');
    } else {
        portError.classList.add('hidden');
    }
});
