/**
 * Icon Generator Script
 * 
 * This script generates PNG icons from the SVG source.
 * 
 * Usage:
 *   node generate-icons.js
 * 
 * Requirements:
 *   - Node.js with canvas module: npm install canvas
 *   - Or use an online SVG to PNG converter
 *   - Or use ImageMagick: convert -background none icons/icon.svg -resize 128x128 icons/icon128.png
 */

const fs = require('fs');
const path = require('path');

// Check if canvas module is available
let createCanvas, loadImage;
try {
  const canvas = require('canvas');
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
} catch (e) {
  console.log('Canvas module not found. Please install it or use alternative methods.');
  console.log('\nAlternative methods:');
  console.log('1. Install canvas: npm install canvas');
  console.log('2. Use ImageMagick:');
  console.log('   convert -background none icons/icon.svg -resize 16x16 icons/icon16.png');
  console.log('   convert -background none icons/icon.svg -resize 48x48 icons/icon48.png');
  console.log('   convert -background none icons/icon.svg -resize 128x128 icons/icon128.png');
  console.log('3. Use an online converter like https://svgtopng.com/');
  console.log('\nFor now, creating placeholder data URL icons...\n');
  
  // Create simple placeholder PNGs using base64 encoded minimal images
  createPlaceholderIcons();
  process.exit(0);
}

async function generateIcons() {
  const sizes = [16, 48, 128];
  const svgPath = path.join(__dirname, 'icons', 'icon.svg');
  
  for (const size of sizes) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Draw red background with rounded corners
    ctx.fillStyle = '#ee0000';
    roundRect(ctx, 0, 0, size, size, size * 0.125);
    ctx.fill();
    
    // Draw document icon
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, size * 0.047);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const scale = size / 128;
    
    // Document outline
    ctx.beginPath();
    ctx.moveTo(80 * scale, 20 * scale);
    ctx.lineTo(40 * scale, 20 * scale);
    ctx.arcTo(32 * scale, 20 * scale, 32 * scale, 28 * scale, 8 * scale);
    ctx.lineTo(32 * scale, 100 * scale);
    ctx.arcTo(32 * scale, 108 * scale, 40 * scale, 108 * scale, 8 * scale);
    ctx.lineTo(88 * scale, 108 * scale);
    ctx.arcTo(96 * scale, 108 * scale, 96 * scale, 100 * scale, 8 * scale);
    ctx.lineTo(96 * scale, 36 * scale);
    ctx.lineTo(80 * scale, 20 * scale);
    ctx.stroke();
    
    // Fold corner
    ctx.beginPath();
    ctx.moveTo(80 * scale, 20 * scale);
    ctx.lineTo(80 * scale, 36 * scale);
    ctx.lineTo(96 * scale, 36 * scale);
    ctx.stroke();
    
    // Lines
    ctx.beginPath();
    ctx.moveTo(40 * scale, 60 * scale);
    ctx.lineTo(88 * scale, 60 * scale);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(40 * scale, 76 * scale);
    ctx.lineTo(88 * scale, 76 * scale);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(40 * scale, 92 * scale);
    ctx.lineTo(64 * scale, 92 * scale);
    ctx.stroke();
    
    // Save to file
    const outputPath = path.join(__dirname, 'icons', `icon${size}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Created: ${outputPath}`);
  }
  
  console.log('\nIcons generated successfully!');
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createPlaceholderIcons() {
  // Simple red square placeholders (1x1 red pixel, scaled)
  const sizes = [16, 48, 128];
  
  // Minimal PNG header with red pixel
  // This creates a simple solid red PNG for each size
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  for (const size of sizes) {
    const outputPath = path.join(__dirname, 'icons', `icon${size}.png`);
    
    // Create a minimal valid PNG (solid red)
    const png = createMinimalPng(size, [238, 0, 0]); // #ee0000
    fs.writeFileSync(outputPath, png);
    console.log(`Created placeholder: ${outputPath}`);
  }
}

function createMinimalPng(size, rgb) {
  // This creates a very basic valid PNG file
  const zlib = require('zlib');
  
  function crc32(data) {
    let crc = -1;
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }
  
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[n] = c;
  }
  
  function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeBuffer = Buffer.from(type);
    const crcData = Buffer.concat([typeBuffer, data]);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(crcData));
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
  }
  
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);  // width
  ihdr.writeUInt32BE(size, 4);  // height
  ihdr.writeUInt8(8, 8);        // bit depth
  ihdr.writeUInt8(2, 9);        // color type (RGB)
  ihdr.writeUInt8(0, 10);       // compression
  ihdr.writeUInt8(0, 11);       // filter
  ihdr.writeUInt8(0, 12);       // interlace
  
  // IDAT chunk (image data)
  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < size; x++) {
      rawData.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  
  // IEND chunk
  const iend = Buffer.alloc(0);
  
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend)
  ]);
}

generateIcons().catch(console.error);
