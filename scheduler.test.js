import test from 'node:test';
import assert from 'node:assert/strict';
import {queue} from './queue.js';
import {publish} from './publish.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
test('December jobs survive restart, cancellation and competing workers',()=>{
  const dir=mkdtempSync(tmpdir()+'/postdesk-'), file=dir+'/q.sqlite';
  const due=Date.UTC(new Date().getUTCFullYear()+1,11,20);
  let q=queue(file);
  const ids=q.add({at:new Date(due).toISOString(),channels:['facebook','instagram'],caption:'December',media:'https://example.org/photo.jpg'});
  q.cancel(ids[1]);q.close();q=queue(file);
  assert.equal(q.claim(due-1),undefined);const p=q.claim(due);assert.equal(p.id,ids[0]);
  const second=queue(file);assert.equal(second.claim(due),undefined);second.close();
  q.finish(p.id,'published','receipt');assert.deepEqual(q.list().map(x=>x.status),['published','cancelled']);q.close();rmSync(dir,{recursive:true});
});
test('Instagram publishes the returned image container',async()=>{
 const urls=[];const result=await publish({channel:'instagram',media:'https://example.org/a.jpg',caption:'hi'},{META_GRAPH_VERSION:'vTEST',META_TOKEN:'test',INSTAGRAM_ACCOUNT_ID:'123'},async(url,opts)=>{urls.push([url,JSON.parse(opts.body)]);return {ok:true,json:async()=>({id:urls.length===1?'container':'post'})};});
 assert.equal(result,'post');assert.equal(urls[1][1].creation_id,'container');
});
