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

// Let Facebook deliver supported near-term posts at their exact requested time.
export async function scheduleFacebook(p,e,send=fetch){
  if(!configured('facebook',e))throw Error('Connect Facebook before scheduling.');
  const base='https://graph.facebook.com/'+e.META_GRAPH_VERSION+'/';
  async function call(path,body){
    const r=await send(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+e.META_TOKEN,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
    const data=await r.json();
    if(!r.ok||data.error)throw Error('Facebook rejected this request'+(data.error?.code?' (code '+data.error.code+')':'')+'. '+(data.error?.error_user_msg||'Check your connection and media, then try again.'));
    return data;
  }
  const scheduled_publish_time=Math.floor(p.due/1000);
  let result;
  if(p.mediaKind==='video')result=await call(e.FACEBOOK_PAGE_ID+'/videos',{file_url:p.media,description:p.caption,published:false,scheduled_publish_time});
  else{
    const attached_media=[];
    if(p.media){const photo=await call(e.FACEBOOK_PAGE_ID+'/photos',{url:p.media,published:false});if(!photo.id)throw Error('Facebook did not return a photo receipt.');attached_media.push({media_fbid:photo.id});}
    result=await call(e.FACEBOOK_PAGE_ID+'/feed',{message:p.caption,published:false,scheduled_publish_time,...(attached_media.length?{attached_media}:{})});
  }
  if(!result.id)throw Error('Facebook did not return a scheduling receipt.');
  return result.id;
}
