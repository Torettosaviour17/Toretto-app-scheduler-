const queueKey='planner/queue-v1';
async function snapshot(env){
  const object=await env.BUCKET.get(queueKey);
  return {rows:object?await object.json():[],etag:object?.etag};
}
async function change(env, edit){
  for(let i=0;i<8;i++){
    const {rows,etag}=await snapshot(env),result=edit(rows);
    const saved=await env.BUCKET.put(queueKey,JSON.stringify(rows),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});
    if(saved)return result;
  }
  throw Error('Queue is busy. Please try again.');
}
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
async function handle(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='GET' && path==='/')return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  if(!env.BUCKET)return json({error:'Queue storage is unavailable'},503);
  const channels=['facebook','instagram','x'];
  if(request.method==='GET' && path==='/api/posts')return json({posts:(await snapshot(env)).rows.sort((a,b)=>a.due-b.due),configured:channels.filter(c=>configured(c,env))});
  if(request.headers.has('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origin mismatch'},403);
  if(request.method==='POST' && path==='/api/posts'){
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
    const body=await request.json(),due=Date.parse(body.at),selected=Array.isArray(body.channels)?[...new Set(body.channels)]:[];
    if(!selected.length || selected.some(c=>!channels.includes(c)) || !Number.isFinite(due)||due<=Date.now()||typeof body.caption!=='string'||!body.caption.trim()||body.caption.length>63000)return json({error:'Choose channels, a future date and a caption.'},400);
    const media=body.media||'';
    if((media && !/^https:\/\//i.test(media))||(selected.includes('instagram')&&!media)||(selected.includes('x')&&(media||[...body.caption].length>280)))return json({error:'Instagram needs a public HTTPS image. X accepts text up to 280 characters.'},400);
    const posts=selected.map(channel=>({id:crypto.randomUUID(),channel,due,caption:body.caption,media,status:'queued'}));
    await change(env,rows=>rows.push(...posts));
    return json({ids:posts.map(p=>p.id)},201);
  }
  if(request.method==='DELETE' && path.startsWith('/api/posts/')){
    const ok=await change(env,rows=>{const p=rows.find(x=>x.id===path.split('/').pop()&&x.status==='queued');if(p)p.status='cancelled';return !!p});
    return json(ok?{cancelled:true}:{error:'Only queued posts can be cancelled'},ok?200:409);
  }
  if(request.method==='POST' && path==='/api/tick'){
    if(request.headers.get('X-Scheduler-Run')!=='due')return json({error:'Run header required'},400);
    const eligible=(await snapshot(env)).rows.some(p=>p.status==='queued'&&p.due<=Date.now()&&configured(p.channel,env));
    if(!eligible)return json({processed:0});
    const p=await change(env,rows=>{const job=rows.filter(x=>x.status==='queued'&&x.due<=Date.now()&&configured(x.channel,env)).sort((a,b)=>a.due-b.due)[0];if(job)job.status='sending';return job});
    if(!p)return json({processed:0});
    let status,result;try{result=await publish(p,env);if(!result)throw Error('Missing platform receipt');status='published';}catch(e){status='review';result=e.message;}
    await change(env,rows=>{Object.assign(rows.find(x=>x.id===p.id),{status,result})});return json({processed:1,status});
  }
  return json({error:'Unknown endpoint'},404);
}
export default {async fetch(req,env){try{return await handle(req,env)}catch(e){return json({error:e.message},500)}}};
