// Local UI preview only. This is not part of the deployed Worker.
import http from 'node:http';
import fs from 'node:fs';
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/api/posts'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({posts:[],configured:['facebook']}));return}
 if(req.url==='/sw.js'){res.setHeader('Content-Type','application/javascript');res.end('');return}
 if(req.url==='/manifest.webmanifest'){res.setHeader('Content-Type','application/manifest+json');res.end('{}');return}
 if(req.url.startsWith('/icon')){const file=req.url.slice(1);if(/^icon(\.svg|-192\.png|-512\.png)$/.test(file)){res.setHeader('Content-Type',file.endsWith('svg')?'image/svg+xml':'image/png');res.end(fs.readFileSync(file));return}}
 res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('index.html'));
}).listen(Number(process.env.PORT)||3000,'0.0.0.0');
