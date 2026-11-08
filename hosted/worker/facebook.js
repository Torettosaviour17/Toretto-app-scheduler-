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
  if(path==='/facebook'&&req.method==='GET'){
    const config=await readPrivate(env,'config'),active=await readPrivate(env,'page');
    const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Code After Dark</title><style>body{background:#121720;color:#eee;font:17px/1.6 system-ui;max-width:560px;margin:5vh auto;padding:20px}a{color:#b9e99e}label{display:block;margin:12px 0}input,button{font:inherit;padding:10px;box-sizing:border-box;width:100%}button{background:#b9e99e;border:0;border-radius:6px}code{overflow-wrap:anywhere}</style><a href="/">← Post desk</a><h1>Connect Code After Dark</h1>'+(active?'<p>Facebook Page connected.</p>':'')+(config?'':'<p>One-time setup: open <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta for Developers</a>, select your app, and register this exact Valid OAuth Redirect URI:</p><code>'+url.origin+callback+'</code><p>For Facebook Login for Business, configure Page listing, reading engagement and publishing permissions, then enter the configuration ID below.</p>')+'<form method="post" action="/facebook/start">'+(config?'':'<label>Meta App ID<input name="appId" required pattern="[0-9]+"></label><label>Meta App Secret<input name="secret" required type="password" autocomplete="off"></label><label>Graph API version from your Meta dashboard<input name="version" required placeholder="vXX.0" pattern="v[0-9]+[.][0-9]+"></label><label>Business login configuration ID (if applicable)<input name="configId" pattern="[0-9]*"></label>')+'<button>Continue with Facebook</button></form>';
    return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://www.facebook.com; base-uri 'none'"}});
  }
  if(path==='/facebook/start'&&req.method==='POST'){
    if(req.headers.get('Origin')!==url.origin)return info('Invalid origin',403);
    let c=await readPrivate(env,'config');
    if(!c){const f=await req.formData();c=Object.fromEntries(['appId','secret','version','configId'].map(k=>[k,(f.get(k)||'').trim()]));
      if(!/^\d+$/.test(c.appId)||!/^v\d+\.\d+$/.test(c.version)||!c.secret||!/^\d*$/.test(c.configId))return info('Check the Meta app settings.',400);
      await storePrivate(env,'config',c);
    }
    const state=crypto.randomUUID();
    const dest=new URL('https://www.facebook.com/'+c.version+'/dialog/oauth');
    dest.search=new URLSearchParams({client_id:c.appId,redirect_uri:url.origin+callback,state,response_type:'code',...(c.configId?{config_id:c.configId}:{scope:'pages_show_list,pages_read_engagement,pages_manage_posts'})});
    return new Response(null,{status:303,headers:{Location:dest.href,'Set-Cookie':'__Host-fbstate='+state+'; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax','Cache-Control':'no-store'}});
  }
  if(path===callback&&req.method==='GET'){
    const state=url.searchParams.get('state');
    if(!state||!req.headers.get('Cookie')?.split(';').some(x=>x.trim()==='__Host-fbstate='+state))return info('Verification expired. Open /facebook and try again.',403);
    const code=url.searchParams.get('code');if(!code)return info('Facebook authorization was not completed. Return to /facebook to try again.',400);
    const c=await readPrivate(env,'config'),base='https://graph.facebook.com/'+c.version;
    const exchange=async(params)=>{const r=await fetch(base+'/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:c.appId,client_secret:c.secret,...params})});const b=await r.json();if(!r.ok||!b.access_token)throw Error('Facebook token exchange failed. Check app settings and redirect URI.');return b.access_token};
    const token=await exchange({code,redirect_uri:url.origin+callback});
    const long=await exchange({grant_type:'fb_exchange_token',fb_exchange_token:token});
    const res=await fetch(base+'/me/accounts?fields=id,name,access_token,tasks&limit=100',{headers:{Authorization:'Bearer '+long}});
    const p=(await res.json()).data?.find(row=>row.id===targetPage);
    if(!p?.access_token || !p.tasks?.some(t=>['CREATE_CONTENT','MANAGE'].includes(t)))return info('Code After Dark was not authorized for publishing. Open /facebook and select that Page with content access.',403);
    await storePrivate(env,'page',{token:p.access_token,id:p.id,version:c.version});
    return new Response(null,{status:303,headers:{Location:'/','Set-Cookie':'__Host-fbstate=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax','Referrer-Policy':'no-referrer'}});
  }
  return info('Unknown route',404);
}
