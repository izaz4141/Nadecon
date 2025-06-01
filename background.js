function sendUrlToApp(url) {
  const port = 12345;

  return new Promise((resolve, reject) => {
    fetch(`http://localhost:${port}`, {
      method: 'POST',
      body: JSON.stringify({ url: url }),
          headers: { 'Content-Type': 'application/json' }
    })
    .then(response => {
      if (response.ok) {
        console.log('Successfully Sent', url);
        resolve();
      } else {
        console.error('Failed to send URL to application');
        reject();
      }
    })
    .catch(error => {
      console.error('Error sending URL:', error);
      reject();
    });
  });
}

browser.contextMenus.create({
  id: "send-to-nadeko",
  title: "Send to Nadeko",
  contexts: ["page"]
});
browser.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case "send-to-nadeko":
      sendUrlToApp(info.pageUrl).
      break;
    }  
});
browser.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "send-to-nadeko":
      return sendUrlToApp(message.url)
      .catch(error => {
        // Re-throw the error to propagate to content script
        throw error;
      });
  }
});
