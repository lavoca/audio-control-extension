# Sound Control Panel - Browser Companion

A browser extension that detects audio activity inside Chrome tabs, including:
- Playing state
- Paused state
- Muted state
- Volume changes
- Tab metadata (title, URL, etc.)

This is the browser extension for the **Sound Control Panel** desktop application. Its purpose is to enable the desktop app to monitor and control the audio of individual browser tabs.
For the main desktop application, please see the [Sound Control Panel repository](https://github.com/lavoca/sound-control-panel).

## Current Functionality

*   **Audio Detection:** A content script monitors web pages for `<audio>` and `<video>` elements, reporting their status (playing, paused, volume, mute state) to a central background script.
*   **WebSocket Communication:** The background script establishes a persistent WebSocket connection to the desktop application.
    *   It sends a real-time list of all audible tabs to the desktop app.
    *   It receives commands (e.g., set volume, set mute) from the desktop app and relays them to the appropriate content script.
*   **Connection Management:** Includes an automatic reconnection strategy with exponential backoff to handle cases where the desktop application is restarted.
*   **Popup UI:** Provides a simple interface built with Vue 3 to view the status of detected tabs.

## Tech Stack
- TypeScript
- Vue 3
- WXT (Web Extension Toolkit)
- Chrome Extension APIs
- WebExtensions API, WebSockets

## Install the Extension:
    *   Download the `.zip` file from this repository's [Releases page](https://github.com/lavoca/audio-control-extension/releases/tag/v1.0.0).
    *   Unzip the file to a permanent location.
    *   In your browser's extensions page (e.g., `chrome://extensions`), enable "Developer mode".
    *   Click "Load unpacked" and select the unzipped folder.

## Development Setup

### Prerequisites

*   Node.js and pnpm

### Running in Development Mode

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/lavoca/audio-control-extension.git
    cd your-extension-repo-link
    ```
2.  **Install dependencies:**
    ```bash
    pnpm install
    ```
3.  **Start the development server:**
    ```bash
    pnpm dev
    ```
4.  **Load the unpacked extension:**
    *   In your browser, load the unpacked extension from the `.output/chrome-mv3` directory (or the directory for your target browser).

## License
MIT

