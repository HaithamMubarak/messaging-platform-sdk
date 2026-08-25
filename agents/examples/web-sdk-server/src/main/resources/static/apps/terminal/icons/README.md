# 🎨 PWA Icon Generator for SDK Terminal

This folder contains tools to generate all required PWA (Progressive Web App) icon sizes from the SVG source.

## ✨ Quick Generation (Recommended)

### Option 1: Browser-Based Generator (No Installation Required)

1. Open `generate-icons.html` in your web browser
2. Click **"Generate All Icons"**
3. Click **"Download All (ZIP)"** to get all icons in one file
4. Extract the ZIP and copy all PNG files to this `icons/` folder
5. Reload the terminal app - PWA install prompt will appear!

**URL**: `http://localhost:8084/apps/terminal/icons/generate-icons.html`

### Option 2: Node.js Script (Automated)

If you have Node.js installed:

```bash
# Install the required dependency
npm install sharp

# Run the generator script
node generate-icons.js
```

All icons will be automatically saved to this folder.

## 📋 Required Icon Sizes

The PWA manifest requires these icon sizes:

- **72x72** - Small devices
- **96x96** - Small devices  
- **128x128** - Medium devices
- **144x144** - Medium devices
- **152x152** - iOS devices
- **192x192** - Standard (Android)
- **384x384** - Large devices
- **512x512** - Extra large (splash screens)

## 🛠️ Manual Generation (Alternative)

### Using ImageMagick

If you have [ImageMagick](https://imagemagick.org/) installed:

```bash
convert icon.svg -resize 72x72 icon-72x72.png
convert icon.svg -resize 96x96 icon-96x96.png
convert icon.svg -resize 128x128 icon-128x128.png
convert icon.svg -resize 144x144 icon-144x144.png
convert icon.svg -resize 152x152 icon-152x152.png
convert icon.svg -resize 192x192 icon-192x192.png
convert icon.svg -resize 384x384 icon-384x384.png
convert icon.svg -resize 512x512 icon-512x512.png
```

### Online Tools

You can also use these online generators:

- [RealFaviconGenerator](https://realfavicongenerator.net/)
- [PWA Builder Image Generator](https://www.pwabuilder.com/imageGenerator)
- [Favicon.io](https://favicon.io/)

Just upload `icon.svg` and download all required sizes.

## 🔍 Troubleshooting

### PWA Install Prompt Not Showing?

The browser requires:

1. ✅ **HTTPS or localhost** - You must be on a secure connection
2. ✅ **Valid manifest.json** - Check console for errors
3. ✅ **All icons present** - All PNG files must exist in this folder
4. ✅ **Service worker registered** - Check browser DevTools → Application → Service Workers
5. ✅ **Not already installed** - PWA can only be installed once per origin

### Check Your Setup

Open browser DevTools (F12) and:

1. Go to **Application** tab
2. Check **Manifest** section - all icons should show with green checkmarks
3. Check **Service Workers** section - should show "activated and running"
4. Look for console errors related to manifest or icons

### Force Re-check

1. Clear browser cache
2. Unregister service worker (DevTools → Application → Service Workers → Unregister)
3. Reload the page
4. The install prompt should appear within a few seconds

## 📱 Testing PWA Installation

After generating icons:

1. Open terminal: `http://localhost:8084/apps/terminal/app.html`
2. Wait 5-10 seconds (browser checks PWA requirements)
3. Look for install button in the toolbar OR browser's install prompt
4. Click to install as a standalone app!

## 🎯 Icon Design

The current icon features:

- **Background**: Dark terminal theme (#1a1a2e)
- **Terminal window**: Blue accent (#4a9eff)
- **Animated cursor**: Blinking terminal cursor
- **Cloud icon**: Represents cloud sharing feature (#22d3ee)

To customize, edit `icon.svg` with any SVG editor, then regenerate.

## 📄 Files in This Folder

- **icon.svg** - Source SVG (512x512, scalable)
- **generate-icons.html** - Browser-based generator
- **generate-icons.js** - Node.js generator script
- **icon-*.png** - Generated PNG files (created after running generator)

---

**Need help?** Check the main [Terminal Documentation](../README.md) or PWA Guide


