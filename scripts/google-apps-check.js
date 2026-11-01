// Local test profile only. No Google account or external website is opened here.
(async () => {
  const frames=[],results=[],errors=[];
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const wait=async predicate=>{for(let count=0;count<400;count++){if(await predicate())return;await pause(25);}throw new Error('Google apps check timed out');};
  const record=scenario=>{results.push({scenario,passed:true});const item=document.createElement('li');item.textContent='PASS: '+scenario;document.querySelector('ol').append(item);};
  const open=async version=>{
    const frame=document.createElement('iframe');frames.push(frame);
    frame.src=version==='legacy'?'../legacy/home.html':'../home.html';
    frame.addEventListener('load',()=>frame.contentWindow.addEventListener('error',event=>errors.push(event.message)));
    document.body.append(frame);
    await wait(()=>frame.contentDocument?.body?.classList.contains('app-ready'));
    const win=frame.contentWindow;await wait(()=>win.t('google_apps.title')!=='google_apps.title');
    return{frame,win,doc:frame.contentDocument};
  };
  const panel=page=>page.doc.getElementById('google-apps-panel');
  const toggle=page=>page.doc.getElementById('google-apps-toggle');
  const show=page=>{if(panel(page).hidden)toggle(page).click();};
  const close=page=>{if(!panel(page).hidden)toggle(page).click();};
  const click=(page,selector)=>{const button=page.doc.querySelector(selector);assert(button,'Missing control: '+selector);button.click();};
  try{
    let modern=await open('modern');const legacy=await open('legacy');
    show(modern);show(legacy);
    assert(toggle(modern).getAttribute('aria-expanded')==='true','Launcher did not open');
    assert(panel(modern).querySelectorAll('a.google-apps-tile').length===19,'Service catalog is incomplete');
    for(const link of panel(modern).querySelectorAll('a.google-apps-tile')){
      assert(link.target==='_blank'&&link.rel.includes('noopener')&&link.href.startsWith('https://'),'Unsafe or framed service link');
    }
    // Hidden test frames do not trigger lazy image loading; request their icons explicitly.
    panel(modern).querySelectorAll('.google-apps-grid img').forEach(img=>{img.loading='eager';});
    await wait(()=>[...panel(modern).querySelectorAll('.google-apps-grid img')].every(img=>img.complete&&img.naturalWidth>0));
    assert([...panel(modern).querySelectorAll('img')].every(img=>new URL(img.src).origin===location.origin),'Launcher requests remote icons');
    for(const page of [modern,legacy])assert(!page.doc.querySelector('#google-apps-link-account,.google-apps-favorites,[data-apps-edit]'),'Removed account or favorites UI remains');
    record('Both interfaces open a 19-service list with local icons and new-tab links');

    const first=modern.doc.getElementById('google-apps-link-search');
    first.focus();
    first.dispatchEvent(new modern.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert(modern.doc.activeElement.id==='google-apps-link-maps','Keyboard grid navigation failed: '+modern.doc.activeElement.id);
    modern.doc.activeElement.dispatchEvent(new modern.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert(panel(modern).hidden&&modern.doc.activeElement===toggle(modern),'Escape did not close and restore focus');
    show(modern);modern.doc.body.dispatchEvent(new modern.win.Event('pointerdown',{bubbles:true}));
    assert(panel(modern).hidden,'Outside click did not dismiss');
    show(modern);modern.doc.getElementById('open-settings').focus();
    // Inactive hidden frames can update activeElement without dispatching native focus events.
    modern.doc.getElementById('open-settings').dispatchEvent(new modern.win.FocusEvent('focusin',{bubbles:true}));
    assert(panel(modern).hidden,'Moving focus outside left the panel open: '+modern.doc.activeElement.id);
    record('Arrow keys navigate; Escape restores focus; outside clicks and focus changes dismiss the panel');

    close(modern);show(modern);
    const appIds=page=>[...panel(page).querySelectorAll('a.google-apps-tile')].map(link=>link.id).join(',');
    const original=appIds(modern);
    for(const language of ['en','zh-CN','ja','ko','th','ms']){
      await modern.win.loadLanguage(language);modern.win.applyTranslations();
      assert(toggle(modern).getAttribute('aria-label')===modern.win.t('google_apps.title'),'Toggle is not localized');
      for(const {id} of modern.win.lunarGoogleApps.catalog)assert(modern.win.t('google_apps.services.'+id)!=='google_apps.services.'+id,'Missing service translation');
      for(const theme of ['light','dark']){
        modern.win.eval(`updateSetting('theme',${JSON.stringify(theme)});flushPendingSettingChanges()`);
        assert(appIds(modern)===original,'Theme change altered the service list');
      }
    }
    record('Six interface languages and light/dark themes preserve the service list');

    modern.frame.style.width='320px';modern.frame.style.height='450px';await pause(60);
    const bounds=panel(modern).getBoundingClientRect();
    assert(bounds.left>=0&&bounds.right<=320&&bounds.bottom<=450,'Panel overflows a small viewport');
    const content=panel(modern).querySelector('.google-apps-content');content.scrollTop=content.scrollHeight;
    assert(content.scrollTop>0,'Long app list is not scrollable');
    assert(errors.length===0,'Unexpected page error: '+errors.join('; '));
    record('The complete app list scrolls within a 320×450 viewport without overflowing');
    if(new URLSearchParams(location.search).has('preview')){
      await modern.win.loadLanguage('en');modern.win.applyTranslations();
      modern.frame.style.width='390px';modern.frame.style.height='800px';
      content.scrollTop=0;
      const images=[...panel(modern).querySelectorAll('img')];
      images.forEach(img=>{img.loading='eager';});
      await Promise.all(images.map(img=>img.decode()));
      legacy.frame.remove();modern.frame.style.opacity='1';return;
    }
  }catch(error){results.push({scenario:error.stack||error.message,passed:false});}
  finally{if(!new URLSearchParams(location.search).has('preview')){
    frames.forEach(frame=>frame.remove());
    await fetch('/__viewport-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,results})});
  }}
})();
