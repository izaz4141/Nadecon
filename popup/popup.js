// Add styles for the popup
const style = document.createElement('style');
style.textContent = `
#media-detector-popup {
position: fixed;
bottom: 20px;
left: 20px;
background: #2a2a2e;
color: white;
padding: 15px 20px;
border-radius: 12px;
box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
display: flex;
align-items: center;
gap: 15px;
z-index: 10000;
border-left: 4px solid #0a84ff;
animation: fadeIn 0.5s ease-out;
font-family: Arial, sans-serif;
}

#media-detector-popup .popup-icon {
font-size: 1.8rem;
}

#media-detector-popup .popup-content h3 {
margin: 0 0 5px 0;
font-size: 1rem;
}

#media-detector-popup .popup-content p {
margin: 0;
font-size: 0.9rem;
opacity: 0.8;
}

#media-detector-popup .download-btn {
font-size: 0.9rem;
background: rgba(255, 255, 255, 0.1);
color: #fff;
border: none;
border-radius: 6px;
cursor: pointer;
transition: background 0.3s;

}

#media-detector-popup .close-btn {
background: rgba(255, 255, 255, 0.1);
border: none;
color: #fff;
width: 28px;
height: 28px;
border-radius: 50%;
cursor: pointer;
display: flex;
align-items: center;
justify-content: center;
transition: background 0.3s;
}

#media-detector-popup .download-btn:hover ,
#media-detector-popup .close-btn:hover {
background: rgba(255, 255, 255, 0.2);
}

#media-detector-popup .download-btn.error {
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
`;
document.head.appendChild(style);

// Detect media playback
document.addEventListener('play', function(e) {
    if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') {
        // Remove existing popup if any
        const existingPopup = document.getElementById('media-detector-popup');
        if (existingPopup) existingPopup.remove();

        // Create new popup
        const popup = document.createElement('div');
        popup.id = 'media-detector-popup';

        // Determine media type
        const mediaType = e.target.tagName.toLowerCase();
        const icon = mediaType === 'video' ? '🎬' : '🔊';
        const typeText = mediaType === 'video' ? 'Video' : 'Audio';

        popup.innerHTML = `
        <div class="popup-icon">${icon}</div>
        <div class="popup-content">
        <h3>Media Detected</h3>
        <button class="download-btn">Download ${typeText}</button>
        </div>
        <button class="close-btn">✕</button>
        `;

        document.body.appendChild(popup);

        // Add close functionality
        popup.querySelector('.close-btn').addEventListener('click', () => {
            console.log("Closed");
            popup.remove();
        });

        // Add send URL functionality
        const downloadButton = popup.querySelector('.download-btn');
        downloadButton.addEventListener('click', () => {
            // Disable button and show sending state
            downloadButton.disabled = true;
            downloadButton.textContent = 'Sending...';

            // Send the URL to the background script
            browser.runtime.sendMessage({
                type: 'send-to-nadeko',
                url: window.location.href
            }).then(() => {
                // Success state
                downloadButton.textContent = '✓ URL Sent!';
                downloadButton.style.background = '#30e60b';

                // Remove popup after delay
                setTimeout(() => {
                    popup.remove();
                }, 1500);
            }).catch(error => {
                  handleDownloadError(downloadButton, popup);
             });
        });

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (document.body.contains(popup)) {
                popup.remove();
            }
        }, 5000);
    }
}, true);

// Handle send errors
function handleDownloadError( downloadButton, popup) {
    // Update button to show error
    downloadButton.textContent = '✗ Failed! Connecting with App';
    downloadButton.style.background = '#ff0039';
    downloadButton.classList.add('error');
    downloadButton.disabled = false;

    // Add new click event for retry
    const newHandler = () => {
        downloadButton.removeEventListener('click', newHandler);
        downloadButton.click();
    };
    downloadButton.addEventListener('click', newHandler);

    // Revert button after 5 seconds
    setTimeout(() => {
        if (popup.isConnected) {
            downloadButton.textContent = 'Send URL to App';
            downloadButton.style.background = '#0a84ff';
            downloadButton.classList.remove('error');
        }
    }, 5000);
}

// Also detect dynamically added media
const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                node.addEventListener('play', handlePlay);
            }
            if (node.querySelectorAll) {
                node.querySelectorAll('video, audio').forEach(media => {
                    media.addEventListener('play', handlePlay);
                });
            }
        });
    });
});

function handlePlay(event) {
    // Trigger the same logic as above
    document.dispatchEvent(new Event('play'));
}

// Start observing
observer.observe(document, {
    childList: true,
    subtree: true
});

// Attach to existing media
document.querySelectorAll('video, audio').forEach(media => {
    media.addEventListener('play', handlePlay);
});
