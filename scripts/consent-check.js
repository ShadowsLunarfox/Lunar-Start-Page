// Disposable localhost profile only. Optional data access must never block the homepage.
(async () => {
  const results = [], frames = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = async predicate => {
    for (let i=0;i<400;i++) { if (await predicate()) return; await delay(25); }
    throw new Error('Feature privacy check timed out');
  };
  const record = scenario => { results.push({scenario,passed:true}); const item=document.createElement('li'); item.textContent='PASS: '+scenario; document.querySelector('ol').append(item); };
  const clear = () => { frames.splice(0).forEach(frame=>frame.remove()); localStorage.clear(); };
  const open = async (version='modern') => {
    const frame=document.createElement('iframe'); frame.style.cssText='width:390px;height:700px;border:0';
    frame.src=version==='modern'?'../home.html':'../legacy/home.html'; frames.push(frame);document.body.append(frame);
    await wait(()=>frame.contentDocument?.body?.classList.contains('app-ready'));
    const win=frame.contentWindow, doc=frame.contentDocument;
    await wait(()=>win.t('feature_privacy.title')!=='feature_privacy.title');
    return {frame,win,doc};
  };
  const modal = page => page.doc.getElementById('feature-privacy-dialog');
  const answer = async (page, action) => {
    await wait(()=>modal(page)?.open);
    modal(page).querySelector(`[data-privacy-action="${action}"]`).click();
    await wait(()=>!modal(page));
  };
  const resources = page => page.win.performance.getEntriesByType('resource').map(item=>new URL(item.name)).filter(url=>url.origin!==location.origin && /^https?:/.test(url.protocol));
  try {
    clear();
    // An old accepted terms record must not grant any feature permission.
    localStorage.setItem('lunarLegalConsent:v1',JSON.stringify({termsVersion:'2026-10-31',privacyVersion:'2026-11-01-media-v2',acceptedAt:new Date().toISOString()}));
    let page=await open();
    assert(!page.doc.querySelector('dialog[open]')&&!page.win.lunarLegalConsent,'First visit is still blocked by an agreement');
    assert(page.doc.querySelector('.search-data-notice').textContent.includes('query'),'Search transmission is not disclosed');
    await delay(250);
    assert(!resources(page).length,'Homepage requested an external resource before any feature agreement');
    assert(!page.doc.querySelector('.shortcut-icon img[src^="https:"]'),'Saved shortcut icons leaked before consent');
    assert(!page.win.lunarPrivacy.has('suggestions')&&!page.win.lunarPrivacy.has('resources'),'Old terms agreement granted feature access');
    record('First visit opens immediately, shows the search notice, and makes no automatic external requests or blanket consent migration');

    if (new URLSearchParams(location.search).has('preview')) {
      page.frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;opacity:1';
      void page.win.lunarPrivacy.request('suggestions'); return;
    }

    for (const version of ['modern','legacy']) {
      clear(); page=await open(version);
      let fetches=0;const realFetch=page.win.fetch;
      page.win.fetch=(url,options)=>{
        if (/^https?:/.test(String(url))) {fetches++;return Promise.resolve({ok:true,json:async()=>['typed query',['network suggestion']]});}
        return realFetch.call(page.win,url,options);
      };
      assert((await page.win.fetchRemoteSearchSuggestions('private draft')).length===0&&fetches===0,'Remote suggestions ran without consent');
      const select=page.doc.getElementById('search-suggestions-setting');
      select.value='on';select.dispatchEvent(new page.win.Event('change'));
      await answer(page,'cancel');
      assert(select.value==='off'&&!page.win.lunarPrivacy.has('suggestions')&&fetches===0,'Cancel enabled online suggestions');
      select.value='on';select.dispatchEvent(new page.win.Event('change'));await answer(page,'agree');
      assert((await page.win.fetchRemoteSearchSuggestions('typed query')).length>0&&fetches>0,'Explicit agreement did not enable suggestions');
      const before=fetches;
      page.win.lunarPrivacy.revoke('suggestions');
      assert((await page.win.fetchRemoteSearchSuggestions('another private draft')).length===0&&fetches===before,'Revocation did not stop requests');
      const imported=page.win.sanitizeSettings({searchSuggestionsEnabled:true});
      assert(imported.searchSuggestionsEnabled===false,'Imported settings bypassed feature consent');
    }
    record('Both interfaces keep suggestions off until explicit agreement; cancel, revocation and imported settings cannot bypass it');

    clear();page=await open();
    const peer=await open('legacy');
    let pending=page.win.lunarPrivacy.request('resources');await answer(page,'agree');assert(await pending,'Resources were not enabled');
    await wait(()=>peer.win.lunarPrivacy.has('resources'));
    assert(page.doc.querySelector('.shortcut-icon img[src^="https:"]'),'Consented online icons were not rendered');
    peer.win.lunarPrivacy.revoke('resources');
    await wait(()=>!page.win.lunarPrivacy.has('resources')&&!page.doc.querySelector('.shortcut-icon img[src^="https:"]'));
    assert(!page.win.lunarPrivacy.allowsUrl('https://example.com/imported-wallpaper.jpg'),'External wallpaper bypassed the resource choice');
    assert(page.win.lunarPrivacy.allowsUrl('data:image/png;base64,AAAA')&&page.win.lunarPrivacy.allowsUrl('resource/icons/lunar-v2-32.png'),'Local images require online permission');
    record('Resource choices synchronize across interfaces; revocation removes online icons and blocks external wallpapers while local assets stay available');

    clear();page=await open();
    const originalSet=page.win.Storage.prototype.setItem;
    page.win.Storage.prototype.setItem=function(key,value){if(key.startsWith('lunarFeatureConsent:'))throw new Error('Storage unavailable');return originalSet.call(this,key,value);};
    pending=page.win.lunarPrivacy.request('suggestions');
    await wait(()=>modal(page)?.open);modal(page).querySelector('[data-privacy-action="agree"]').click();
    assert(modal(page).open&&!modal(page).querySelector('[role="alert"]').hidden&&!page.win.lunarPrivacy.has('suggestions'),'Failed persistence granted access');
    await answer(page,'cancel');assert(!await pending,'Cancel after a storage failure granted access');
    page.win.Storage.prototype.setItem=originalSet;
    record('A storage failure keeps the optional feature off and allows canceling back to the usable homepage');

    for(const version of ['modern','legacy']) {
      clear();page=await open(version);
      let starts=0,uploads=0;
      page.win.SpeechRecognition=class {addEventListener(){}start(){starts++;}stop(){}};
      const voice=page.win.handleVoiceSearchToggle();await answer(page,'cancel');await voice;
      assert(starts===0,'Microphone started before agreement');
      const nextVoice=page.win.handleVoiceSearchToggle();await answer(page,'agree');await nextVoice;
      assert(starts===1,'Microphone did not start after agreement');
      const realSearch=page.win.submitSearchQuery;let submitted=0;
      page.win.submitSearchQuery=()=>{submitted++;};
      page.win.lunarPrivacy.revoke('voice');
      page.win.handleVoiceSearchResult({resultIndex:0,results:[{isFinal:true,0:{transcript:'late recognition result'}}]});
      assert(submitted===0,'A late recognition result searched after voice consent was revoked');
      page.win.submitSearchQuery=realSearch;
      const realSubmit=page.win.HTMLFormElement.prototype.submit;
      page.win.HTMLFormElement.prototype.submit=function(){uploads++;};
      const file=new page.win.File(['fixture'],'fixture.png',{type:'image/png'});
      let image=page.win.submitGoogleImageSearchFile(file);await answer(page,'cancel');await image;
      assert(uploads===0,'Image uploaded before agreement');
      image=page.win.submitGoogleImageSearchFile(file);await answer(page,'agree');await image;
      assert(uploads===1,'Image did not upload after agreement');
      page.win.HTMLFormElement.prototype.submit=realSubmit;
    }
    record('Voice recognition and image upload start only after their own data-use notice is accepted in either interface');

    clear();page=await open();
    for(const language of ['en','zh-CN','yue','ja','ko','th','ms']) {
      // Exercise every bundled disclosure even for languages not exposed in the main selector.
      const locale=await(await fetch(`../data/language/${language}.json`)).json();
      page.win.eval('translations='+JSON.stringify(locale));
      page.win.lunarPrivacy.localize();
      assert(page.doc.querySelector('[data-privacy-text="title"]').textContent===locale.feature_privacy.title,'Disclosure language missing: '+language);
      pending=page.win.lunarPrivacy.request('suggestions');
      await wait(()=>modal(page)?.open);
      assert(modal(page).querySelector('h2').textContent===locale.feature_privacy.suggestions_title,'Wrong modal language: '+language);
      assert(modal(page).scrollWidth<=modal(page).clientWidth+1,'Mobile disclosure overflows: '+language);
      await answer(page,'cancel');await pending;
    }
    assert(page.doc.querySelector('[data-legal-document="privacy"]')&&page.doc.querySelector('[data-legal-document="terms"]'),'Settings lost legal document links');
    record('All seven languages provide feature-specific notices without mobile horizontal overflow; legal document links remain in settings');
  } catch(error) { results.push({scenario:error.stack||error.message,passed:false}); }
  finally { if(!new URLSearchParams(location.search).has('preview'))clear(); }
  await fetch('/__viewport-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,results})});
})();
