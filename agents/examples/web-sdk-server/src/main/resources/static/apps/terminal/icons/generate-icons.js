/**
 * Generate PWA icon PNGs from SVG source
 *
 * Requirements: npm install sharp
 * Usage: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.error('❌ Error: sharp module not found.');
    console.error('Please install it by running: npm install sharp');
    process.exit(1);
}

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SVG_PATH = path.join(__dirname, 'icon.svg');
const OUTPUT_DIR = __dirname;

async function generateIcons() {
    console.log('🎨 Generating PWA icons from SVG...\n');

    if (!fs.existsSync(SVG_PATH)) {
        console.error('❌ Error: icon.svg not found at', SVG_PATH);
        process.exit(1);
    }

    const svgBuffer = fs.readFileSync(SVG_PATH);

    for (const size of ICON_SIZES) {
        try {
            const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);

            await sharp(svgBuffer)
                .resize(size, size)
                .png()
                .toFile(outputPath);

            console.log(`✅ Generated: icon-${size}x${size}.png`);
        } catch (error) {
            console.error(`❌ Failed to generate ${size}x${size}:`, error.message);
        }
    }

    console.log('\n✨ Icon generation complete!');
    console.log(`Generated ${ICON_SIZES.length} icon files in: ${OUTPUT_DIR}`);
}

generateIcons().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});

