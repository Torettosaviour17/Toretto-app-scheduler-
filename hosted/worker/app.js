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
  const url=new URL(request.url);
  url.protocol='https:';
  url.host='toretto-post-desk.cloudlesspoppy8.chatgpt.site';
  const path=url.pathname;
  if(request.method==='GET'&&path.startsWith('/media/')){
    if(!/^\/media\/[a-f0-9-]+\.(png|jpg|webp|mp4)$/.test(path))return json({error:'Not found'},404);
    const file=await env.BUCKET.get(path.slice(1));if(!file)return json({error:'Not found'},404);
    return new Response(file.body,{headers:{'Content-Type':file.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
  }
  if(request.method==='GET'&&PWA[path])return new Response(PWA[path].base64?Uint8Array.from(atob(PWA[path].base64),c=>c.charCodeAt(0)):PWA[path].body,{headers:{'Content-Type':PWA[path].type,'Cache-Control':'no-cache','Service-Worker-Allowed':'/'}});
  const owner=request.headers.get('oai-authenticated-user-email')?.toLowerCase()==='torettosavads1@gmail.com';
  const runner=path==='/api/tick' && env.SCHEDULER_RUN_KEY && request.headers.get('X-Run-Token')===env.SCHEDULER_RUN_KEY;
  const queueRequest = ['/api/posts','/api/media'].includes(path) && ['GET','POST'].includes(request.method);
  const chatPlanner = queueRequest && !request.headers.has('Origin') && env.SCHEDULER_RUN_KEY &&
    request.headers.get('X-Planner-Token') === env.SCHEDULER_RUN_KEY;
  if(!owner && !runner && !chatPlanner){
    if(request.method==='GET' && ['/', '/facebook','/facebook/callback'].includes(path) && !request.headers.has('oai-authenticated-user-id'))
      return Response.redirect(url.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent(url.pathname+url.search),302);
    if(request.method==='GET' && ['/', '/facebook','/facebook/callback'].includes(path))
      return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Switch account</title><main style="max-width:32rem;margin:12vh auto;padding:20px;font:18px/1.5 system-ui"><h1>Switch ChatGPT account</h1><p>This account does not own After Dark Scheduler. Use the ChatGPT account that created this planner.</p><a href="/signout-with-chatgpt?return_to=%2Ffacebook">Use a different account</a></main>',{status:403,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    return json({error:'Owner sign-in required'},403);
  }
  if(request.method==='GET' && path==='/')return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  if(!env.BUCKET)return json({error:'Queue storage is unavailable'},503);
  if(path==='/facebook'||path.startsWith('/facebook/'))return facebookRoute(request,env,url);
  const page=await readPrivate(env,'page');
  const fbEnv=page?{META_TOKEN:page.token,FACEBOOK_PAGE_ID:page.id,META_GRAPH_VERSION:page.version}:env;
  const providerEnv=c=>c==='facebook'?fbEnv:env;
  const channels=['facebook','instagram','x'];
  if(request.method==='GET' && path==='/api/posts'){
    const rows=(await snapshot(env)).rows;
    const checks=rows.filter(p=>p.status==='scheduled'&&(p.due<=Date.now()||url.searchParams.get('verify')==='1')).slice(0,20);
    for(const p of checks){try{
      const r=await fetch('https://graph.facebook.com/'+fbEnv.META_GRAPH_VERSION+'/'+encodeURIComponent(p.result)+'?fields=is_published,scheduled_publish_time',{headers:{Authorization:'Bearer '+fbEnv.META_TOKEN},signal:AbortSignal.timeout(10000)});
      const data=await r.json();if(r.ok&&typeof data.is_published==='boolean'){
        const patch={facebookPublished:data.is_published,facebookScheduledTime:data.scheduled_publish_time||null,confirmedAt:new Date().toISOString(),...(data.is_published?{status:'published'}:{})};
        await change(env,all=>{const current=all.find(x=>x.id===p.id);if(current?.status==='scheduled')Object.assign(current,patch)});Object.assign(p,patch);
      }
    }catch{/* Preserve the confirmed schedule during temporary read failures. */}}
    return json({posts:rows.sort((a,b)=>a.due-b.due),configured:channels.filter(c=>configured(c,providerEnv(c))),facebookDiagnostic:await readPrivate(env,'diagnostic')});
  }
  if(request.headers.has('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origin mismatch'},403);
  if(request.method==='POST'&&path==='/api/media'){
    const type=request.headers.get('content-type')?.split(';')[0],ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4'}[type];
    if(!ext)return json({error:'Choose a JPG, PNG, WebP or MP4 file.'},415);
    const max=ext==='mp4'?40*1024*1024:10*1024*1024;
    if(Number(request.headers.get('content-length'))>max)return json({error:'File too large: photos up to 10 MB, videos up to 40 MB.'},413);
    const reader=request.body?.getReader();if(!reader)return json({error:'Empty file'},400);
    const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return json({error:'File too large'},413)}chunks.push(value)}
    if(!size)return json({error:'Empty file'},400);
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
    const key='media/'+crypto.randomUUID()+'.'+ext;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});
    return json({url:url.origin+'/'+key,mediaKind:ext==='mp4'?'video':'image'},201);
  }
  if(request.method==='POST' && path==='/api/posts'){
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
    const body=await request.json(),due=Date.parse(body.at),selected=Array.isArray(body.channels)?[...new Set(body.channels)]:[];
    if(!selected.length || selected.some(c=>!channels.includes(c)) || !Number.isFinite(due)||due<=Date.now()||typeof body.caption!=='string'||(!body.caption.trim()&&!body.media)||body.caption.length>63000)return json({error:'Choose channels, a future date and a caption.'},400);
    const media=body.media||'';
    if((media && !/^https:\/\//i.test(media))||(selected.includes('instagram')&&!media)||(selected.includes('x')&&(media||[...body.caption].length>280)))return json({error:'Instagram needs a public HTTPS image. X accepts text up to 280 characters.'},400);
    if(selected.some(c=>!configured(c,providerEnv(c))))return json({error:'Connect the selected account first.'},400);
    if(due<Date.now()+660000)return json({error:'Choose a time at least 11 minutes from now.'},400);
    if(due>Date.now()+28*86400000)return json({error:'Facebook scheduling currently supports the next 28 days.'},400);
    if(body.mediaKind==='video'&&!media)return json({error:'Upload a video first.'},400);
    const posts=selected.map(channel=>({id:crypto.randomUUID(),channel,due,caption:body.caption,media,mediaKind:body.mediaKind==='video'?'video':'image',status:'preparing'}));
    await change(env,rows=>rows.push(...posts));
    for(const p of posts){
      try{if(p.channel!=='facebook')throw Error('This planner currently supports Facebook only.');p.result=await scheduleFacebook(p,fbEnv);p.status='scheduled';}
      catch(e){p.result=e.message;p.status='review';}
      await change(env,rows=>{Object.assign(rows.find(x=>x.id===p.id),p)});
    }
    return json({posts,ids:posts.map(p=>p.id),error:posts.find(p=>p.status==='review')?.result},posts.some(p=>p.status==='review')?502:201);
  }
  if(request.method==='DELETE' && path.startsWith('/api/posts/')){
    const id=path.split('/').pop(),p=(await snapshot(env)).rows.find(x=>x.id===id);
    if(!p||!['queued','scheduled'].includes(p.status)||p.due<=Date.now())return json({error:'Only future scheduled posts can be cancelled.'},409);
    if(p.status==='scheduled'){
      const base='https://graph.facebook.com/'+fbEnv.META_GRAPH_VERSION+'/'+encodeURIComponent(p.result);
      const check=await fetch(base+'?fields=is_published,scheduled_publish_time',{headers:{Authorization:'Bearer '+fbEnv.META_TOKEN}});const data=await check.json();
      if(!check.ok||data.is_published!==false||!data.scheduled_publish_time||data.scheduled_publish_time*1000<=Date.now())return json({error:'Facebook could not confirm that this post is still scheduled. Refresh before cancelling.'},409);
      const r=await fetch(base,{method:'DELETE',headers:{Authorization:'Bearer '+fbEnv.META_TOKEN}});const deleted=await r.json();
      if(!r.ok||deleted.success!==true)return json({error:'Facebook did not confirm cancellation.'},502);
    }
    await change(env,rows=>{rows.find(x=>x.id===id).status='cancelled'});return json({cancelled:true});
  }

  if(request.method==='POST' && path==='/api/tick'){
    if(request.headers.get('X-Scheduler-Run')!=='due')return json({error:'Run header required'},400);
    const eligible=(await snapshot(env)).rows.some(p=>p.status==='queued'&&p.due<=Date.now()&&configured(p.channel,providerEnv(p.channel)));
    if(!eligible)return json({processed:0});
    const p=await change(env,rows=>{const job=rows.filter(x=>x.status==='queued'&&x.due<=Date.now()&&configured(x.channel,providerEnv(x.channel))).sort((a,b)=>a.due-b.due)[0];if(job)job.status='sending';return job});
    if(!p)return json({processed:0});
    let status,result;try{result=await publish(p,providerEnv(p.channel));if(!result)throw Error('Missing platform receipt');status='published';}catch(e){status='review';result=e.message;}
    await change(env,rows=>{Object.assign(rows.find(x=>x.id===p.id),{status,result})});return json({processed:1,status});
  }
  return json({error:'Unknown endpoint'},404);
}
export default {async fetch(req,env){try{return await handle(req,env)}catch(e){return json({error:e.message},500)}}};
