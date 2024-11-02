# Early Performance Optimizer Extension

A browser extension that optimizes web pages for better performance before they load.

## Features

- 🚀 Early optimization of web resources
- 🖼️ Smart image loading and optimization
- 📜 Script loading optimization
- 🔄 Resource hints optimization
- 👁️ Viewport-based rendering optimization
- 🎨 Animation and transition handling
- 🔧 Configurable settings
- 🦊 Cross-browser support (Chrome & Firefox)

## Installation

### From Web Stores

- Chrome Web Store: [Link to Chrome extension]
- Firefox Add-ons: [Link to Firefox add-on]

### From Releases

1. Go to [Releases](https://github.com/lmn451/early-performance-optimizer/releases)
2. Download the latest version:
   - `chrome-extension.zip` for Chrome
   - `firefox-extension.zip` for Firefox
3. Install in your browser:
   - **Chrome**:
     1. Go to `chrome://extensions/`
     2. Enable "Developer mode"
     3. Drag and drop `chrome-extension.zip` into the extensions page
   - **Firefox**:
     1. Go to `about:addons`
     2. Click the gear icon and select "Install Add-on From File"
     3. Select `firefox-extension.zip`

### Build From Source

1. Prerequisites:

   - Node.js (v18 or later)
   - npm (comes with Node.js)
   - Git

2. Clone and setup:

   ```bash
   # Clone the repository
   git clone https://github.com/yourusername/early-performance-optimizer.git

   # Navigate to project directory
   cd early-performance-optimizer

   # Install dependencies
   npm install

   # Build both versions
   npm run build

   # Or build specific version
   npm run build:chrome
   npm run build:firefox
   ```

### Project Structure
