# GimmeSummary - PDF Summarizer

GimmeSummary is a private, secure AI document assistant for Chrome and Firefox. It processes documents locally in the browser context and handles AI completions through a secure Cloudflare Worker proxy, keeping your API configurations hidden and safe.

## Features
- **Dynamic Summaries**: Custom bullet points, TL;DR, or child-friendly explanations.
- **Interactive Chat Workspace**: Talk to your PDF to query data and clarify text.
- **Visual Workflows**: Maps procedures and timelines into Mermaid.js flowcharts.
- **Doxygen Helper**: Automatically extracts code signatures and builds documented headers.
- **100% Free**: Run summaries at direct API costs with zero developer markups.

## Build & Installation

### Build files:
1. Run `npm install` to install dependencies.
2. Run `npm run build` to generate the production `dist` directory.

### Install on Google Chrome:
1. Open `chrome://extensions` in your browser.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `/dist` directory.

### Install on Mozilla Firefox:
1. Open `about:debugging` in Firefox.
2. Click **This Firefox** on the left menu.
3. Click **Load Temporary Add-on** and select `manifest.json` inside the `/dist_firefox` directory.

---
Designed with privacy in mind. Deployed live on Netlify at [gimmesummary.netlify.app](https://gimmesummary.netlify.app).
