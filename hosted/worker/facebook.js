function chooseFacebookPage(pages){
  const candidates=pages.filter(p=>p.name?.trim().toLowerCase()==='code after dark');
  const page=pages.find(p=>p.id===targetPage) || (candidates.length===1?candidates[0]:null);
  if(!page){
    const names=pages.map(p=>p.name).filter(Boolean).join(', ');
    return {error: candidates.length>1?'More than one Page named Code After Dark was returned. Approve only the intended Page and reconnect.':'Facebook returned '+(names||'no Pages')+'. Reconnect and select Code After Dark.'};
  }
  if(!page.access_token)return {error:'Facebook returned Code After Dark without a Page token. Reconnect with Page publishing access.'};
  if(!page.tasks?.some(t=>['CREATE_CONTENT','MANAGE','PROFILE_PLUS_CREATE_CONTENT'].includes(t)))return {error:'Your Facebook profile needs content access to Code After Dark. Facebook returned these Page tasks: '+(page.tasks?.join(', ')||'none')+'. Check Page access, then reconnect.'};
  return {page};
}
const targetPage='1308783775658337';
const callback='/facebook/callback';
const enc=new TextEncoder();
async function vault(env){
  return crypto.subtle.importKey('raw',Uint8Array.from(atob(env.FB_VAULT_KEY),s=>s.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function storePrivate(env,name,value){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(name)},await vault(env),enc.encode(JSON.stringify(value)));
  await env.BUCKET.put('fb/'+name,JSON.stringify([Array.from(iv),Array.from(new Uint8Array(bytes))]));
}
async function readPrivate(env,name){
  const record=await env.BUCKET.get('fb/'+name);
  if(!record)return null;
  const [iv,bytes]=await record.json();
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:enc.encode(name)},await vault(env),new Uint8Array(bytes));
  return JSON.parse(new TextDecoder().decode(data));
}
function info(message,status=200){
  return new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
async function facebookRoute(req,env,url){
  const path=url.pathname;
  if(path==='/facebook/recheck'&&req.method==='POST'){
    const f=await req.formData(),csrf=f.get('csrf');
    if(!csrf||!req.headers.get('Cookie')?.split(';').some(x=>x.trim()==='__Host-fbcsrf='+csrf))return info('Reopen the connection page and try again.',403);
    const c=await readPrivate(env,'config'),pending=await readPrivate(env,'pending');
    if(!c||!pending)return info('Reconnect once to save a Facebook session for checking.',400);
    const result=await resolveFacebookConnection(env,c,pending.token);
    return result.error?info(result.error,403):Response.redirect(url.origin+'/',303);
  }
  if(path==='/facebook'&&req.method==='GET'){
    const config=await readPrivate(env,'config'),active=await readPrivate(env,'page');
    const csrf=crypto.randomUUID();
    const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Code After Dark</title><style>body{background:#121720;color:#eee;font:17px/1.6 system-ui;max-width:560px;margin:5vh auto;padding:20px}a{color:#b9e99e}label{display:block;margin:12px 0}input,button{font:inherit;padding:10px;box-sizing:border-box;width:100%}button{background:#b9e99e;border:0;border-radius:6px}code{overflow-wrap:anywhere}</style><a href="/">← Post desk</a><h1>Connect Code After Dark</h1>'+(active?'<p>Facebook Page connected.</p>':'')+(config?'':'<p>One-time setup: open <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta for Developers</a>, select your app, and register this exact Valid OAuth Redirect URI:</p><code>'+url.origin+callback+'</code><p>For Facebook Login for Business, configure Page listing, reading engagement and publishing permissions, then enter the configuration ID below.</p>')+'<form method="post" action="/facebook/start" target="_top"><input type="hidden" name="csrf" value="'+csrf+'">'+(config?'':'<label>Meta App ID<input name="appId" value="1128630636565623" required pattern="[0-9]+"></label><label>Meta App Secret<input name="secret" required type="password" autocomplete="off"></label><label>Graph API version from your Meta dashboard<input name="version" value="v27.0" required placeholder="vXX.0" pattern="v[0-9]+[.][0-9]+"></label><label>Business login configuration ID (if applicable)<input name="configId" pattern="[0-9]*"></label>')+'<button>Continue with Facebook</button></form>';
    return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'__Host-fbcsrf='+csrf+'; Max-Age=900; Path=/; Secure; HttpOnly; SameSite=Lax','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://www.facebook.com; base-uri 'none'"}});
  }
  if(path==='/facebook/start'&&req.method==='POST'){
    const f=await req.formData();
    const csrf=f.get('csrf');
    const csrfCookie=req.headers.get('Cookie')?.split(';').some(x=>x.trim()==='__Host-fbcsrf='+csrf);
    if(!csrf || !csrfCookie)return info('This connection form expired. Reopen /facebook and try again.',403);
    const origin=req.headers.get('Origin');
    if(origin && origin!=='null' && origin!==url.origin)return info('Open the connection form directly on your scheduler and try again.',403);
    let c=await readPrivate(env,'config');
    if(!c){c=Object.fromEntries(['appId','secret','version','configId'].map(k=>[k,(f.get(k)||'').trim()]));
      if(!/^\d+$/.test(c.appId)||!/^v\d+\.\d+$/.test(c.version)||!c.secret||!/^\d*$/.test(c.configId))return info('Check the Meta app settings.',400);
      await storePrivate(env,'config',c);
    }
    const state=crypto.randomUUID();
    const dest=new URL('https://www.facebook.com/'+c.version+'/dialog/oauth');
    dest.search=new URLSearchParams({client_id:c.appId,redirect_uri:url.origin+callback,state,response_type:'code',auth_type:'rerequest',...(c.configId?{config_id:c.configId}:{scope:'pages_show_list,pages_read_engagement,pages_manage_posts'})});
    const link=dest.href.replaceAll('&','&amp;').replaceAll('"','&quot;');
    return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Facebook approval</title><style>body{background:#121720;color:#eee;font:18px/1.6 system-ui;max-width:32rem;margin:10vh auto;padding:24px}a{display:block;background:#b9e99e;color:#102010;padding:16px;border-radius:8px;text-align:center;text-decoration:none}</style><h1>Your app details are saved</h1><p>Tap below to open Facebook and choose Code After Dark.</p><a href="'+link+'" target="_top" rel="noreferrer">Open Facebook approval</a>',{headers:{'Content-Type':'text/html; charset=utf-8','Set-Cookie':'__Host-fbstate='+state+'; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"}});

  }
  if(path===callback&&req.method==='GET'){
    const state=url.searchParams.get('state');
    if(!state||!req.headers.get('Cookie')?.split(';').some(x=>x.trim()==='__Host-fbstate='+state))return info('Verification expired. Open /facebook and try again.',403);
    const code=url.searchParams.get('code');if(!code)return info('Facebook authorization was not completed. Return to /facebook to try again.',400);
    const c=await readPrivate(env,'config'),base='https://graph.facebook.com/'+c.version;
    const exchange=async(params)=>{const r=await fetch(base+'/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:c.appId,client_secret:c.secret,...params})});const b=await r.json();if(!r.ok||!b.access_token)throw Error('Facebook token exchange failed. Check app settings and redirect URI.');return b.access_token};
    const token=await exchange({code,redirect_uri:url.origin+callback});
    const long=await exchange({grant_type:'fb_exchange_token',fb_exchange_token:token});
    await storePrivate(env,'pending',{token:long,version:c.version,savedAt:Date.now()});
    const result=await resolveFacebookConnection(env,c,long);
    if(result.error)return info(result.error,403);
    return new Response(null,{status:303,headers:{Location:'/','Set-Cookie':'__Host-fbstate=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax','Referrer-Policy':'no-referrer'}});
  }
  return info('Unknown route',404);
}

async function resolveFacebookConnection(env,c,token,send=fetch){
  const base='https://graph.facebook.com/'+c.version;
  async function get(path,access=token){
    const r=await send(base+path,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(20000)});
    const body=await r.json();
    return {ok:r.ok,body};
  }
  const permission=await get('/me/permissions');
  const required=['pages_show_list','pages_read_engagement','pages_manage_posts'];
  const granted=permission.body.data?.filter(p=>p.status==='granted').map(p=>p.permission)||[];
  const missing=required.filter(name=>!granted.includes(name));
  const report={checkedAt:new Date().toISOString(),granted,missing,pages:[],approvedPageIds:[],connected:false};
  async function stop(error){report.error=error;await storePrivate(env,'diagnostic',report);return {error};}
  if(!permission.ok)return stop('Facebook could not verify your permissions. Reconnect your Facebook account.');
  if(missing.length)return stop('Facebook approval is missing '+missing.join(', ')+'. Reconnect and enable these permissions.');
  const listed=await get('/me/accounts?fields=id,name,access_token,tasks&limit=100');
  const pages=listed.ok?(listed.body.data||[]):[];
  report.pages=pages.map(p=>({id:p.id,name:p.name,tasks:p.tasks||[]}));
  // Permission target IDs represent the Pages selected in Facebook's approval dialog.
  const debug=await get('/debug_token?input_token='+encodeURIComponent(token),c.appId+'|'+c.secret);
  const scopes=debug.ok?debug.body.data?.granular_scopes||[]:[];
  const targets=[...new Set(scopes.filter(s=>required.includes(s.scope)).flatMap(s=>s.target_ids||[]))];
  report.approvedPageIds=targets;
  let selected=chooseFacebookPage(pages);
  if(!selected.page){
    for(const id of targets.slice(0,25)){
      if(!/^\d+$/.test(id))continue;
      const direct=await get('/'+id+'?fields=id,name,access_token');
      const p=direct.body;
      if(!direct.ok||!p.access_token||p.name?.trim().toLowerCase()!=='code after dark')continue;
      if(!pages.some(row=>row.id===p.id))pages.push({...p,tasks:['CREATE_CONTENT']});
    }
    selected=chooseFacebookPage(pages);
  }
  if(!selected.page){
    if(!pages.length&&!targets.length)return stop('Facebook approved the permissions but supplied no Page assets. In Facebook, open Settings → Business integrations → App Scheduler → View and edit. Enable Code After Dark for listing, reading and publishing, then reconnect here. If the Page is absent there, check that your logged-in profile has Facebook access to the Page.');
    return stop(selected.error||'Facebook did not return a usable Page token.');
  }
  const page=selected.page;
  await storePrivate(env,'page',{token:page.access_token,id:page.id,name:page.name,version:c.version});
  report.connected=true;report.page={id:page.id,name:page.name};await storePrivate(env,'diagnostic',report);
  return {connected:true,page:report.page};
}
