# Video Downloader Connector Extension 

![Extension Icon](icons/nadecon-96.png)


A Firefox extension that detects media on webpages and sends it to a companion desktop application for downloading.

## Features

- Detects video and audio elements on webpage
- One-click sending of media URLs to the desktop application

## Requirements

1. Nadeko Downloader
2. Firefox browser (version 91+ recommended)

## Installation

1. Download the extension in [**GitHub Releases**](https://github.com/izaz4141/Nadecon/releases/latest/download/NadeCon.xpi)
2. Go to [about:config](about:config)
3. Turn `xpinstall.signatures.required` off ( sorry no verification yet )
4. Go to [**Manage your Extension**](about:addons)
5. Click on the ⚙ and select **Install Add-on from File...**
6. Select the downloaded NadeCon.xpi

## Usage

1. Ensure Nadeko Downloader is running
2. Browse to any webpage with media content
3. Click the extension icon in Firefox's toolbar or popup
4. The desktop application will automatically:
    - Fetch video information
    - Display thumbnail and format options
    - Prepare for download
    
## Planned Features

1. Window in add-on to show media
2. Window in add-on to select quality and download media
3. Window in add-on to configure port, turnoff popup

## Troubleshooting
1. "Error sending URL" in browser console:
    - Ensure desktop application is running
    - Check firewall allows connections on port 12345
    - Verify application didn't crash on startup
2. No media detected:
    - Some sites use iframes or custom players
    - Extension falls back to page URL
    - Manually copy-paste URL into application as alternative
3. Thumbnail not loading:
    - Some videos might not have thumbnails
    - Check internet connection
    - Verify no ad-blockers are blocking thumbnail domains
