const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const srcDir = 'C:\\Users\\Jacob\\AppData\\Local\\Temp\\kilo\\flux\\horse-hero';
const dstDir = 'C:\\ProjectDevelopment\\heroes-js\\.kilo\\worktrees\\hero-movement-iso\\src\\resources\\units';

const files = fs.readdirSync(srcDir).filter(f => f.startsWith('hero-') && f.endsWith('.png'));

async function process() {
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dst = path.join(dstDir, f.replace('hero-', 'hero-player-'));
    
    // Get RGBA buffer by converting to RGBA
    const { data, info } = await sharp(src)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const w = info.width;
    const h = info.height;
    const channels = info.channels;
    
    // Replace white pixels with transparent
    for (let i = 0; i < data.length; i += channels) {
      if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) {
        data[i + channels - 1] = 0; // Set alpha to 0
      }
    }
    
    await sharp(data, { raw: { width: w, height: h, channels: channels } })
      .png()
      .toFile(dst);
    console.log('Processed: ' + f + ' -> ' + dst);
  }
  console.log('Done');
}

process().catch(console.error);
