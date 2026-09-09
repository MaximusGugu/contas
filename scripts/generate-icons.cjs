const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');

async function generate() {
  const dir = path.join(__dirname, '../assets/icons');
  const svg = fs.readFileSync(path.join(dir, 'app-icon.svg'), 'utf8');
  // System-masked icons need a full background; ordinary icons retain alpha.
  const maskable = svg.replace('rx="112"', 'rx="0"');
  for (const size of [192, 512]) {
    for (const [prefix, source] of [['icon', svg], ['icon-maskable', maskable]]) {
      const file = path.join(dir, `${prefix}-${size}.png`);
      await sharp(Buffer.from(source)).resize(size, size).png().toFile(file);
      const pixel = await sharp(file).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
      const expectedAlpha = prefix === 'icon' ? 0 : 255;
      if (pixel[3] !== expectedAlpha) throw new Error(`Unexpected corner alpha: ${file}`);
      console.log(`${prefix}-${size}.png: corner alpha ${pixel[3]}`);
    }
  }
}

generate().catch(error => { console.error(error); process.exitCode = 1; });
