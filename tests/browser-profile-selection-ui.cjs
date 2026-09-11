// Run: npx electron tests/browser-profile-selection-ui.cjs
// Actual Nami renderer with synthetic local profiles; no real browser import.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const profiles=require('../src/main/browser-profiles');
profiles.detectChromiumProfiles=()=>[];profiles.cookieImportStatus=()=>({available:false,browsers:[]});
app.getVersion=()=>require('../package.json').version;
process.argv.push('--demo','--scene=browser','--theme=paper');
require('../src/main/main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await pause(40);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  let win;
  try{
    await until(()=>win=BrowserWindow.getAllWindows()[0],'window');
    const run=s=>win.webContents.executeJavaScript(s),click=s=>run(`document.querySelector(${JSON.stringify(s)}).click()`);
    const invoke=args=>run(`dainami.browserProfiles(${JSON.stringify(args)})`);
    const choose=value=>run(`(()=>{const e=document.querySelector('#profile-choice');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const shot=async name=>{if(!process.env.NAMI_REVIEW_DIR)return;await pause(200);fs.mkdirSync(process.env.NAMI_REVIEW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR,name+'.png'),(await win.webContents.capturePage()).toPNG());};
    await until(()=>run('!!document.querySelector(".browser-address")'),'browser pane');
    const id=await run('document.querySelector(".browser-tile").dataset.id');
    await until(()=>run(`dainami.browserStatus().then(r=>r.views.some(v=>v.id===${JSON.stringify(id)}))`),'native tab');
    assert.equal(await run('document.querySelector(".browser-profile")'),null,'profile management does not crowd the address row');
    const openManager=async()=>{
      await click('[data-browser-action="menu"]');
      await run(`Array.from(document.querySelectorAll('.browser-menu button')).find(b=>b.textContent.startsWith('Profile:')).click()`);
      await until(()=>run('!!document.querySelector("#profile-choice")'),'profile settings');
    };
    const switched=async profileId=>until(()=>run(`!document.querySelector('#profile-choice')?.disabled && document.querySelector('#profile-choice')?.value===${JSON.stringify(profileId)} && dainami.browserStatus().then(r=>r.views.find(v=>v.id===${JSON.stringify(id)})?.profileId===${JSON.stringify(profileId)})`),'applied dropdown profile');
    const work=(await invoke({action:'create',name:'Work'})).profile;
    await session.fromPartition('persist:nami-browser-'+work.id).cookies.set({url:'https://fixture.example.test',name:'synthetic',value:'test-only'});
    await openManager();
    assert.equal(await run('document.querySelector("#profile-choice").closest("label").childNodes[0].textContent'),'Profile for this tab');
    await choose(work.id);await switched(work.id);
    assert.match(await run('document.querySelector(".browser-profile-context").textContent'),/This tab uses Work/);
    assert.equal(await run('!!document.querySelector("#profile-switch,.browser-profile-confirm")'),false,'choosing a profile applies it without hidden extra steps');
    await until(()=>run('document.querySelector(".browser-profile-contents")?.textContent.includes("1 session cookie")'),'honest cookie label');
    assert.doesNotMatch(await run('document.querySelector(".browser-profile-contents").textContent'),/sign-in/);
    await shot('manager-active-work');
    await choose('default');await switched('default');
    await choose(work.id);await switched(work.id);
    await click('#profiles-done');
    await click('.companion-add');await until(()=>run('document.querySelectorAll(".browser-address").length===2'),'second Work tab');
    await until(()=>run('dainami.browserStatus().then(r=>r.views.length===2 && r.views.every(v=>v.profileName==="Work"))'),'both tabs use Work');
    console.log('PASS: dropdown really switches both ways, honest cookie labels, menu profile identity and new-tab Work inheritance.');
    // A target can disappear after the manager loaded its options.
    const temp=(await invoke({action:'create',name:'Temporary'})).profile;
    await openManager();await invoke({action:'remove',profileId:temp.id,confirmed:true});await choose(temp.id);
    await until(()=>run('!!document.querySelector(".browser-profile-error")?.textContent && !document.querySelector("#profile-choice").disabled'),'failed-switch recovery');
    assert.match(await run('document.querySelector(".browser-profile-error").textContent'),/no longer available/i);
    assert.equal(await run('document.querySelector("#profile-choice").value'),work.id,'failure restores the actual active choice');
    assert.ok((await run('dainami.browserStatus()')).views.every(v=>v.profileName==='Work'));
    await shot('switch-failed-retry');
    await choose('default');await switched('default');await choose(work.id);await switched(work.id);
    await click('#profiles-done');
    console.log('PASS: unavailable target preserves the tab, restores the real selected profile, and allows a new choice.');
    // The settings entry carries the current browser tab too.
    await click('[data-browser-action="menu"]');
    await run(`Array.from(document.querySelectorAll('.browser-menu button')).find(b=>b.textContent==='Browser settings…').click()`);
    await until(()=>run('!!document.querySelector("[data-browser-settings=profiles]")'),'browser settings');
    await click('[data-browser-settings="profiles"]');
    await until(()=>run('!!document.querySelector("#profile-choice")'),'settings profile manager');
    assert.match(await run('document.querySelector(".browser-profile-context").textContent'),/This tab uses Work/);
    assert.equal(await run('document.querySelector("#profile-choice").value'),work.id,'settings keeps the active tab context');
    await click('#profiles-done');
    console.log('PASS: Browser settings manages the active tab profile.');
    const name='Work '+ 'long name '.repeat(7);
    await invoke({action:'rename',profileId:work.id,name});
    await until(()=>run(`dainami.browserStatus().then(r=>r.views.every(v=>v.profileName===${JSON.stringify(name.trim())}))`),'renamed profile');
    await click('[data-browser-action="menu"]');
    assert.equal(await run(`Array.from(document.querySelectorAll('.browser-menu button')).find(b=>b.textContent.startsWith('Profile:')).textContent`),'Profile: '+name.trim()+'…');
    await run('document.body.dispatchEvent(new Event("pointerdown",{bubbles:true}))');
    for(const [theme,zoom,width,height] of [['paper',1,1200,850],['operator',1,1200,850],['paper',1.75,1000,850],['operator',1.75,1000,850],['operator',1,700,650]]){
      win.setSize(width,height);win.webContents.setZoomFactor(zoom);await run(`document.body.dataset.theme=${JSON.stringify(theme)};window.dispatchEvent(new Event('resize'))`);await pause(150);
      const bad=await run(`Array.from(document.querySelectorAll('.browser-tile')).filter(t=>t.getBoundingClientRect().width>0).flatMap(t=>Array.from(t.querySelectorAll('.browser-address input,.browser-address button')).filter(e=>{const r=e.getBoundingClientRect(),p=t.getBoundingClientRect();return r.width<1||r.left<p.left-1||r.right>p.right+1||r.right>innerWidth+1;}).map(e=>e.className))`);
      assert.deepEqual(bad,[],theme+'/'+zoom+' address controls fit');await shot('profile-'+theme+'-'+zoom+'-'+width);
    }
    console.log('PASS: renamed menu identity and full address controls fit Paper/Operator, compact panes and 1.75 zoom.');
  }catch(e){console.error(e);process.exitCode=1;}finally{app.exit(process.exitCode||0);}
});
