import fs from 'node:fs';
fs.writeFileSync('worker/index.js','const PAGE='+JSON.stringify(fs.readFileSync('index.html','utf8'))+';\n'+fs.readFileSync('worker/pwa.js','utf8')+'\n'+fs.readFileSync('worker/publish.js','utf8')+'\n'+fs.readFileSync('worker/facebook.js','utf8')+'\n'+fs.readFileSync('worker/app.js','utf8'));
