import http from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { timingSafeEqual, createHash } from 'node:crypto';
import { queue } from './queue.js';
import { configured, publish } from './publish.js';
const key=process.env.SCHEDULER_KEY;
if (!key || key.length<24) throw Error('Set SCHEDULER_KEY to at least 24 characters');
const dir=process.env.DATA_DIR||'data'; mkdirSync(dir,{recursive:true});
const q=queue(dir+'/queue.sqlite');
const hash=v=>createHash('sha256').update(v).digest();
const owner=hash('Bearer '+key);
async function tick(){
  const p=q.claim(Date.now());
  if(!p) return;
  try {const id=await publish(p); if(!id) throw Error('Missing platform receipt'); q.finish(p.id,'published',String(id));}
  catch(e){q.finish(p.id,'review',e.message);}
}
async function work(){try{await tick();}catch(e){console.error(e.message);}finally{setTimeout(work,5000).unref();}}
work();
http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(req.method==='GET' && req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(readFileSync(new URL('./index.html',import.meta.url)));return;}
  if(!timingSafeEqual(hash(req.headers.authorization||''),owner))return reply(401,{error:'Enter your scheduler key'});
  try{
    if(req.method==='GET' && req.url==='/api/posts')return reply(200,{posts:q.list(),configured:['facebook','instagram','x'].filter(x=>configured(x))});
    if(req.method==='POST' && req.url==='/api/posts'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>300000)return reply(413,{error:'Request too large'});}
      return reply(201,{ids:q.add(JSON.parse(body))});
    }
    if(req.method==='DELETE' && /^\/api\/posts\/\d+$/.test(req.url))return q.cancel(Number(req.url.split('/').pop()))?reply(200,{cancelled:true}):reply(409,{error:'Only queued posts can be cancelled'});
    reply(404,{error:'Unknown endpoint'});
  }catch(e){reply(400,{error:e.message});}
}).listen(process.env.PORT||3000,process.env.HOST||'127.0.0.1');
