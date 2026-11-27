const fs = require('fs');
const path = require('path');

const vendorDir = path.join(__dirname, '..', 'www', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

const filesToCopy = [
  {
    src: path.join(__dirname, '..', 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
    dest: path.join(vendorDir, 'jspdf.umd.min.js')
  }
];

for (const item of filesToCopy) {
  if (fs.existsSync(item.src)) {
    fs.copyFileSync(item.src, item.dest);
    console.log(`[VoiceCare] Copied ${path.basename(item.src)} -> www/vendor/`);
  } else {
    console.warn(`[VoiceCare] Optional vendor file not found yet: ${item.src}`);
  }
}
