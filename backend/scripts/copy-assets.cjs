// tsc only compiles .ts files, so binary assets referenced at runtime (e.g. the certificate
// logo) need to be copied into dist/ separately as part of the build.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'certificates', 'assets');
const dest = path.join(__dirname, '..', 'dist', 'certificates', 'assets');
fs.cpSync(src, dest, { recursive: true });
console.log('copied certificate assets ->', dest);
