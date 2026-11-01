// Isolated localhost profile only. Tests real decoding, storage and shared UI controls.
(async () => {
  const results = [], frames = [], errors = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = async predicate => {
    for (let count = 0; count < 400; count++) { if (await predicate()) return; await pause(25); }
    throw new Error('Custom font check timed out');
  };
  const record = scenario => { results.push({scenario, passed:true}); const item=document.createElement('li'); item.textContent='PASS: '+scenario; document.querySelector('ol').append(item); };
  const open = async version => {
    const frame = document.createElement('iframe');
    frames.push(frame); frame.src=version==='legacy'?'../legacy/home.html':'../home.html';
    frame.addEventListener('load',()=>frame.contentWindow.addEventListener('error',event=>errors.push(event.message)));
    document.body.append(frame);
    await wait(() => frame.contentDocument?.body?.classList.contains('app-ready'));
    const win=frame.contentWindow;
    await wait(() => win.t('fonts.title')!=='fonts.title');
    await win.lunarFonts.apply(win.eval('state.settings.font'));
    return {frame,win,doc:frame.contentDocument};
  };
  const font = page => page.win.eval('state.settings.font');
  const node = (page, name) => page.doc.getElementById('custom-font-'+name);
  const loaded = page => font(page).type==='file' && [...page.doc.fonts].some(face=>face.family===`LunarFont-${font(page).id}` && face.status==='loaded');
  const sendFile = (page,id,file) => {
    const data=new page.win.DataTransfer();data.items.add(file);
    page.doc.getElementById(id).files=data.files;
    page.doc.getElementById(id).dispatchEvent(new page.win.Event('change',{bubbles:true}));
  };
  try {
    assert(typeof globalThis.__lunarFontFixture==='string','Run through check-browser-ui.mjs --fonts-only with LUNAR_TEST_FONT or the default Windows Arial font');
    let modern=await open('modern'); const legacy=await open('legacy');
    assert(!modern.doc.documentElement.hasAttribute('data-custom-font')&&!legacy.doc.documentElement.hasAttribute('data-custom-font'),'Default fonts were overridden');
    const originalModernTheme=modern.win.eval('state.settings.theme');
    legacy.win.eval('updateSetting("themeStyle","terminal")');
    node(modern,'family').value='Courier New';node(modern,'apply').click();
    await wait(()=>font(legacy).family==='Courier New'&&legacy.doc.documentElement.hasAttribute('data-custom-font'));
    assert(modern.win.getComputedStyle(modern.doc.getElementById('clock')).fontFamily.startsWith('"Courier New"'),'Modern clock ignored the custom font');
    assert(legacy.win.getComputedStyle(legacy.doc.getElementById('clock')).fontFamily.startsWith('"Courier New"'),'Legacy display font overrode the explicit choice');
    assert(modern.win.eval('state.settings.theme')===originalModernTheme&&legacy.win.eval('state.settings.themeStyle')==='terminal','Font synchronization changed a theme');
    record('Installed font choice synchronizes across both interfaces and overrides legacy display fonts without changing either theme');

    modern.frame.remove();modern=await open('modern');
    assert(font(modern).family==='Courier New'&&modern.doc.documentElement.hasAttribute('data-custom-font'),'Font choice did not survive a reload');
    record('Saved installed-font choice is restored after reloading');

    const binary=atob(globalThis.__lunarFontFixture), bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
    sendFile(modern,'custom-font-file',new modern.win.File([bytes],'font-check.ttf',{type:'font/ttf'}));
    await wait(()=>loaded(modern)&&loaded(legacy)&&font(modern).id===font(legacy).id&&!node(modern,'apply').disabled);
    const importedId=font(modern).id;
    assert(localStorage.getItem('lunarShared:v1:field:settings.font').length<250,'Font bytes were stored in synchronous shared settings');
    assert(!localStorage.getItem('customHomeState').includes('base64,'),'Font bytes were stored with normal settings');
    record('A real font file is decoded, saved outside localStorage and loaded by both interfaces');

    for(const file of [new modern.win.File(['bad'],'wrong.txt'),new modern.win.File(['bad'],'broken.ttf'),new modern.win.File([new Uint8Array(20*1024*1024+1)],'large.ttf')]) {
      sendFile(modern,'custom-font-file',file);
      await wait(()=>!node(modern,'apply').disabled);
      assert(font(modern).id===importedId&&loaded(modern),'Rejected font replaced the active face');
    }
    record('Unsupported, corrupt and oversized files leave the active font unchanged');

    const backup=await modern.win.createExportableState();
    assert(backup.fontAsset?.data.includes(';base64,')&&backup.settings.font.id===importedId,'Export omitted the selected font file');
    node(legacy,'reset').click();await wait(()=>!modern.doc.documentElement.hasAttribute('data-custom-font')&&!legacy.doc.documentElement.hasAttribute('data-custom-font'));
    sendFile(modern,'import-file',new modern.win.File([JSON.stringify({state:backup})],'font-backup.json',{type:'application/json'}));
    await wait(()=>loaded(modern)&&loaded(legacy)&&font(modern).id!==importedId&&font(modern).id===font(legacy).id);
    const restored=await legacy.win.createExportableState();
    assert(restored.fontAsset.data.split(',')[1]===backup.fontAsset.data.split(',')[1],'Backup restoration changed the font bytes');
    record('Backup export includes font bytes; importing after reset restores the font in both versions');

    modern.frame.remove();modern=await open('modern');
    await wait(()=>loaded(modern));
    record('Imported font survives reloading and is restored from the shared local font store');

    for(const language of ['en','zh-CN','ja','ko','th','ms']) {
      await modern.win.loadLanguage(language);modern.win.applyTranslations();
      for(const key of ['title','desc','family','apply','import','reset','hint','preview','file_active','invalid','save_failed']) {
        const text=modern.win.t('fonts.'+key);
        assert(text!=='fonts.'+key&&!text.includes('??'),'Font translation is missing or corrupted: '+language+'.'+key);
      }
      for(const theme of ['light','dark']) {
        modern.win.eval(`updateSetting("theme",${JSON.stringify(theme)});flushPendingSettingChanges()`);
        assert(loaded(modern)&&modern.doc.documentElement.hasAttribute('data-custom-font'),'Theme change cleared the custom font');
      }
    }
    await modern.win.loadLanguage('en');modern.win.applyTranslations();
    modern.doc.getElementById('open-settings').click();modern.doc.getElementById('settings-tab-appearance').click();
    modern.frame.style.width='390px';modern.frame.style.height='800px';
    node(modern,'family').scrollIntoView({block:'center'});await pause(80);
    const controls=modern.doc.querySelector('.custom-font-controls'), bounds=controls.getBoundingClientRect();
    assert(controls.scrollWidth<=controls.clientWidth+1&&bounds.right<=390,'Font controls overflow a narrow viewport');
    assert(errors.length===0,'Unexpected page error: '+errors.join('; '));
    record('Font controls remain localized in six languages, preserve the face across light/dark modes and fit a narrow viewport');

    if(new URLSearchParams(location.search).has('preview')) { legacy.frame.remove();modern.frame.style.opacity='1';return; }
    modern.win.resetAppearanceSettings();
    await wait(()=>!modern.doc.documentElement.hasAttribute('data-custom-font')&&!legacy.doc.documentElement.hasAttribute('data-custom-font'));
    assert(font(modern).family===''&&font(legacy).family==='','Appearance reset did not restore default fonts');
    record('Reset appearance restores default fonts in both interfaces');
  } catch(error) { results.push({scenario:error.stack||error.message,passed:false}); }
  finally {
    if(!new URLSearchParams(location.search).has('preview')) {
      frames.forEach(frame=>frame.remove());
      await fetch('/__viewport-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passed:results.filter(result=>result.passed).length,total:results.length,results})});
    }
  }
})();
