export function configured(channel, e=process.env) {
  if(channel==='x') return Boolean(e.X_USER_TOKEN);
  return Boolean(e.META_GRAPH_VERSION && e.META_TOKEN && (channel==='facebook'?e.FACEBOOK_PAGE_ID:e.INSTAGRAM_ACCOUNT_ID));
}
export async function publish(p, e=process.env, send=fetch) {
  if(!configured(p.channel,e)) throw Error('Account credentials missing');
  async function request(url,token,body) {
    const response=await send(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw Error('Platform returned HTTP '+response.status);
    return response.json();
  }
  if(p.channel==='x') return (await request('https://api.x.com/2/tweets',e.X_USER_TOKEN,{text:p.caption})).data.id;
  const base='https://graph.facebook.com/'+e.META_GRAPH_VERSION+'/';
  if(p.channel==='facebook') {
    const path=p.media?'photos':'feed';
    return (await request(base+encodeURIComponent(e.FACEBOOK_PAGE_ID)+'/'+path,e.META_TOKEN,p.media?{url:p.media,caption:p.caption}:{message:p.caption})).id;
  }
  const ig=base+encodeURIComponent(e.INSTAGRAM_ACCOUNT_ID);
  const container=await request(ig+'/media',e.META_TOKEN,{image_url:p.media,caption:p.caption});
  return (await request(ig+'/media_publish',e.META_TOKEN,{creation_id:container.id})).id;
}
