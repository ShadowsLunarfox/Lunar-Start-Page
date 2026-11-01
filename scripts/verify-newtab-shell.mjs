// Isolated unpacked-extension check. No existing browser profile or native media host.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
const root=process.cwd(),profile=await mkdtemp(path.join(tmpdir(),'lunar-newtab-qa-'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let edge,socket,send,destinationServer;
try{
 edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,`--disable-extensions-except=${root}`,`--load-extension=${root}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let count=0;;count++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch(error){if(count>100)throw error;await pause(100);}}
 const endpoint=`http://127.0.0.1:${port}`;
 const targets=await(await fetch(endpoint+'/json/list')).json();
 socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl.replace('ws://localhost:','ws://127.0.0.1:'));
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 const pending=new Map(),contexts=new Map();let sequence=0;
 socket.onmessage=event=>{
   const message=JSON.parse(event.data);
   if(message.method==='Runtime.executionContextCreated')contexts.set(message.params.context.id,message.params.context);
   if(message.method==='Runtime.executionContextDestroyed')contexts.delete(message.params.executionContextId);
   if(message.method==='Runtime.executionContextsCleared')contexts.clear();
   if(!message.id)return;const item=pending.get(message.id);if(!item)return;
   pending.delete(message.id);clearTimeout(item.timer);if(message.error)item.reject(new Error(message.error.message));else item.resolve(message.result);
 };
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Command timed out: '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression,child=false)=>{
   let contextId;
   if(child){const tree=await send('Page.getFrameTree');const frame=tree.frameTree.childFrames?.[0]?.frame;if(!frame)return null;contextId=[...contexts.values()].find(context=>context.auxData?.frameId===frame.id&&context.auxData?.isDefault)?.id;if(!contextId)return null;}
   const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true,...(contextId?{contextId}:{})});
   if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
   return result.result.value;
 };
 const wait=async predicate=>{const until=Date.now()+15000;while(Date.now()<until){try{if(await predicate())return;}catch(error){if(!/context|frame|document|Cannot read|not defined/i.test(error.message))throw error;}await pause(100);}throw new Error('New Tab check timed out');};
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:'edge://newtab/'});
 await wait(()=>evaluate("Boolean(document.getElementById('lunar-start-frame'))"));
 const shellUrl=await evaluate('location.href');
 if(!shellUrl.endsWith('/newtab.html'))throw new Error('Browser did not retain the New Tab entry: '+shellUrl);
 await wait(()=>evaluate("Boolean(document.querySelector('#legal-consent-checkbox:not(:disabled)'))",true));
 await evaluate("document.querySelector('#legal-consent-checkbox').click();document.querySelector('#legal-consent-accept').click()",true);
 await wait(()=>evaluate("document.body.classList.contains('app-ready')",true));
 await evaluate("document.querySelector('[data-browser-theme]').click()",true);
 await wait(async()=>{
   const pages=await(await fetch(endpoint+'/json/list')).json();
   return pages.some(target=>target.url.startsWith('edge://settings/appearance'));
 });
 await send('Target.activateTarget',{targetId:targets.find(target=>target.type==='page').id});
 await evaluate("document.getElementById('google-apps-toggle').click();document.getElementById('google-apps-link-gmail').href='about:blank#lunar-apps-test';document.getElementById('google-apps-link-gmail').click()",true);
 let appTarget;
 await wait(async()=>{
   appTarget=(await(await fetch(endpoint+'/json/list')).json()).find(target=>target.url==='about:blank#lunar-apps-test');
   return Boolean(appTarget);
 });
 if(!await evaluate("document.getElementById('google-apps-panel').hidden",true))throw new Error('Apps launcher did not close after opening a service');
 if(await evaluate('location.href')!==shellUrl)throw new Error('App shortcut replaced the homepage');
 await send('Target.closeTarget',{targetId:appTarget.id});
 await send('Target.activateTarget',{targetId:targets.find(target=>target.type==='page').id});
 if(await evaluate("getHomepageNavigationTarget() !== parent",true))throw new Error('Search does not target the New Tab host');
 await evaluate("document.getElementById('interface-version').value='legacy';document.getElementById('interface-version').dispatchEvent(new Event('change'))",true);
 await wait(()=>evaluate("document.documentElement.dataset.interfaceVersion==='legacy'&&document.body.classList.contains('app-ready')",true));
 if(await evaluate('location.href')!==shellUrl)throw new Error('Switching to legacy exposed its URL');
 await evaluate("document.getElementById('interface-version').value='modern';document.getElementById('interface-version').dispatchEvent(new Event('change'))",true);
 await wait(()=>evaluate("document.documentElement.dataset.interfaceVersion==='modern'&&document.body.classList.contains('app-ready')",true));
 if(await evaluate('location.href')!==shellUrl)throw new Error('Switching to modern exposed its URL');
 await evaluate("SEARCH_ENGINES.google.url=chrome.runtime.getURL('connector.html')+'?q=%s';document.getElementById('search-input').value='new tab navigation';document.getElementById('search-form').requestSubmit()",true);
 await wait(()=>evaluate("location.pathname==='/connector.html'"));
 if(await evaluate("Boolean(document.getElementById('lunar-start-frame'))"))throw new Error('Search provider remained embedded');
 const searchDestination=await evaluate('location.pathname');
 // A real website can refuse frames. Bookmark clicks must navigate the whole tab.
 destinationServer=createServer((request,response)=>{
   response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'"});
   response.end('<!doctype html><html><head><title>Navigation destination</title></head><body data-navigation-destination>Bookmark opened as a full page.</body></html>');
 });
 await new Promise(resolve=>destinationServer.listen(0,'127.0.0.1',resolve));
 const destinationOrigin=`http://127.0.0.1:${destinationServer.address().port}`;
 const bookmarkDestinations=[];
 for(const version of ['modern','legacy']){
   await send('Page.navigate',{url:'edge://newtab/'});
   await wait(()=>evaluate("document.body.classList.contains('app-ready')",true));
   await evaluate(`document.getElementById('interface-version').value=${JSON.stringify(version)};document.getElementById('interface-version').dispatchEvent(new Event('change'))`,true);
   await wait(()=>evaluate(`document.documentElement.dataset.interfaceVersion===${JSON.stringify(version)}&&document.body.classList.contains('app-ready')`,true));
   const destination=destinationOrigin+'/?version='+version;
   await evaluate(`state.links=[{id:'navigation-fixture',name:'Navigation fixture',url:${JSON.stringify(destination)},pinned:false,icon:chrome.runtime.getURL('resource/icons/lunar-v2-32.png')}];renderCollection();document.querySelector('.shortcut-main .shortcut-title').click()`,true);
   await wait(()=>evaluate(`location.href===${JSON.stringify(destination)}`));
   if(!await evaluate("Boolean(document.querySelector('[data-navigation-destination]'))"))throw new Error('Bookmark destination did not load as a full page: '+version);
   if((await send('Page.getFrameTree')).frameTree.childFrames?.length)throw new Error('Bookmark destination is still framed: '+version);
   bookmarkDestinations.push(version);
 }
 console.log('PASS: native New Tab entry stays unchanged across modern/legacy switches; the app launcher opens a new tab; native appearance works; searches and modern/legacy bookmark clicks leave the host, including websites that prohibit framing.');
 console.log(JSON.stringify({newTabDocument:shellUrl,searchDestination,bookmarkDestinations}));
}finally{if(send)await send('Browser.close').catch(()=>{});socket?.close();edge?.kill();destinationServer?.close();}
