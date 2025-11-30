# Chrome Tab Audio Controller

A browser extension that detects audio activity inside Chrome tabs, including:
- Playing state
- Paused state
- Muted state
- Volume changes
- Tab metadata (title, URL, etc.)

The extension is being actively developed and is not yet feature-complete.  
Future versions will integrate with a Tauri desktop app to allow controlling audio per-tab from outside the browser.

## Current Functionality
- Detects `<audio>` and `<video>` elements through a content script
- Captures `play`, `pause`, `ended`, and `volumechange` events
- Sends state updates to a background service
- Popup UI built with Vue displays audio activity per tab

## Tech Stack
- TypeScript
- Vue 3
- WXT (Web Extension Toolkit)
- Chrome Extension APIs

## Status
🚧 **Work in progress**  
The codebase will continue evolving, with regular commits as new features are implemented and bugs are fixed.

## Planned Features
- Control volume per tab
- Mute/unmute tab audio
- Improved UI/UX
- Communication bridge with a Tauri app
- Support for multiple audio streams in the same tab

## License
MIT

