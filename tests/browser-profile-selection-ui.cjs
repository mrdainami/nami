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
    assert.equal(await run('document.querySelector(".browser-profile")?.textContent'),'Personal','address controls show the actual active profile');
    const work=(await invoke({action:'create',name:'Work'})).profile;
    await session.fromPartition('persist:nami-browser-'+work.id).cookies.set({url:'https://fixture.example.test',name:'synthetic',value:'test-only'});
    await click('.browser-profile');await until(()=>run('!!document.querySelector("#profile-choice")'),'profile manager');
    await choose(work.id);await until(()=>run(`document.querySelector('#profile-choice')?.value===${JSON.stringify(work.id)} && document.querySelector('.browser-profile-contents')?.textContent.includes('1 cookie')`),'Work selection');
    assert.equal(await run('document.querySelector(".browser-profile").textContent'),'Personal','manager selection does not claim the tab has switched');
    assert.match(await run('document.querySelector(".browser-profile-context").textContent'),/Personal/);
    assert.match(await run('document.querySelector(".browser-profile-contents").textContent'),/1 session cookie/);
    assert.doesNotMatch(await run('document.querySelector(".browser-profile-contents").textContent'),/sign-in/);
    await shot('manager-selected-work');
    await click('#profile-switch');await click('.browser-profile-confirm .btn--go');
    await until(()=>run('!document.querySelector("#profile-choice")'),'successful welcome switch');
    assert.equal(await run('document.querySelector(".browser-profile").textContent'),'Work');
    await click('.companion-add');await until(()=>run('document.querySelectorAll(".browser-profile").length===2'),'second Work tab');
    await until(()=>run('dainami.browserStatus().then(r=>r.views.length===2 && r.views.every(v=>v.profileName==="Work"))'),'both tabs use Work');
    console.log('PASS: visible backend profile, manager vs active selection, honest cookie labels and second-tab Work inheritance.');
    const selected=await run('document.querySelector(".browser-tile:not([hidden])")?.dataset.id')||id;
    // A target deleted while the confirmation is open leaves retry controls usable.
    const temp=(await invoke({action:'create',name:'Temporary'})).profile;
    await click('.browser-profile');await until(()=>run('!!document.querySelector("#profile-choice")'),'manager');
    await choose(temp.id);await until(()=>run(`document.querySelector('#profile-choice')?.value===${JSON.stringify(temp.id)}`),'temp choice');
    await click('#profile-switch');await invoke({action:'remove',profileId:temp.id,confirmed:true});await click('.browser-profile-confirm .btn--go');
    await until(()=>run('!!document.querySelector(".browser-profile-confirm .btn--go") && !document.querySelector(".browser-profile-confirm .btn--go").disabled'),'failed-switch retry');
    assert.match(await run('document.querySelector(".browser-profile-error").textContent'),/no longer available/i);
    assert.ok((await run('dainami.browserStatus()')).views.every(v=>v.profileName==='Work'));
    await shot('switch-failed-retry');await click('.browser-profile-confirm .btn:not(.btn--go)');await choose(work.id);
    await until(()=>run(`document.querySelector('#profile-choice')?.value===${JSON.stringify(work.id)}`),'Work selected again');
    assert.equal(await run('document.querySelector("#profile-switch").disabled'),true,'already-active profile is clearly marked');
    await click('#profiles-done');
    console.log('PASS: deleted-target failure remains inline, preserves the active profile and enables retry/cancel.');
    const name='Work '+ 'long name '.repeat(7);
    await invoke({action:'rename',profileId:work.id,name});
    await until(()=>run(`Array.from(document.querySelectorAll('.browser-profile')).every(b=>b.textContent===${JSON.stringify(name.trim())})`),'renamed badge');
    for(const [theme,zoom,width,height] of [['paper',1,1200,850],['operator',1,1200,850],['paper',1.75,1000,850],['operator',1.75,1000,850],['operator',1,700,650]]){
      win.setSize(width,height);win.webContents.setZoomFactor(zoom);await run(`document.body.dataset.theme=${JSON.stringify(theme)};window.dispatchEvent(new Event('resize'))`);await pause(150);
      const bad=await run(`Array.from(document.querySelectorAll('.browser-tile')).filter(t=>t.getBoundingClientRect().width>0).flatMap(t=>Array.from(t.querySelectorAll('.browser-address input,.browser-address button')).filter(e=>{const r=e.getBoundingClientRect(),p=t.getBoundingClientRect();return r.width<1||r.left<p.left-1||r.right>p.right+1||r.right>innerWidth+1;}).map(e=>e.className))`);
      assert.deepEqual(bad,[],theme+'/'+zoom+' address controls fit');await shot('profile-'+theme+'-'+zoom+'-'+width);
    }
    console.log('PASS: renamed profiles and full address controls fit Paper/Operator, compact panes and 1.75 zoom.');
  }catch(e){console.error(e);process.exitCode=1;}finally{app.exit(process.exitCode||0);}
});
