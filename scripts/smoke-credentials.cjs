// Explicit integration test: actual Electron safeStorage/Keychain and renderer IPC.
// Uses npm start and a disposable profile; never touches installed-app data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-keychain-smoke-'));
const profile = path.join(temp, 'Nami-dev');
fs.mkdirSync(profile);
const secret = ['dummy','keychain','smoke','123456789'].join('-');
const saved = 'dummy-restart-key-987654321';
const skipped = 'skipped-dummy-value-555';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ theme: 'glass', envKeys: { SMOKE_KEY: secret, 'BAD-NAME': skipped }, openaiKey: secret, sttKey: secret }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = url => new Promise((resolve,reject) => http.get(url, res => { let text=''; res.on('data',c=>text+=c); res.on('end',()=>{try{resolve(JSON.parse(text));}catch(e){reject(e);}}); }).on('error',reject));
async function until(fn, description) {
  const end = Date.now()+25000;
  while(Date.now()<end) { const result=await fn(); if(result) return result; await pause(100); }
  throw new Error('Timed out: '+description);
}
async function launch(check) {
  const marker=path.join(profile,'DevToolsActivePort'); fs.rmSync(marker,{force:true});
  // Keep only launch essentials; no inherited API keys are supplied to this fixture.
  const env=Object.fromEntries(['PATH','HOME','TMPDIR','SHELL','USER','LOGNAME','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const child=spawn('npm',['start','--','--review','--user-data',profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
  let output=''; child.stdout.on('data',c=>output+=c); child.stderr.on('data',c=>output+=c);
  let socket;
  try {
    await until(()=>fs.existsSync(marker),'Electron debugging endpoint');
    const port=fs.readFileSync(marker,'utf8').split('\n')[0];
    const target=await until(async()=>{try{return (await request(`http://127.0.0.1:${port}/json/list`)).find(t=>t.type==='page'&&t.url.startsWith('file:'));}catch{return null;}},'app renderer');
    socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    let id=0; const pending=new Map();
    socket.on('message',raw=>{const m=JSON.parse(raw);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
    async function evaluate(expression) {
      const requestId=++id;
      const response=new Promise(resolve=>pending.set(requestId,resolve));
      socket.send(JSON.stringify({id:requestId,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
      let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Renderer response timed out')),15000);});
      let m;
      try { m=await Promise.race([response,timeout]); } finally { clearTimeout(timer); pending.delete(requestId); }
      if(m.error||m.result.exceptionDetails) throw Error('Renderer evaluation failed');
      return m.result.result.value;
    }
    await until(()=>evaluate('typeof dainami !== "undefined"'),'preload bridge');
    await check(evaluate);
    assert.ok(!output.includes(secret)&&!output.includes(saved)&&!output.includes(skipped),'no secret in app logs');
  } finally {
    socket?.close();
    try { process.kill(-child.pid,'SIGTERM'); } catch {}
    await pause(800);
    try { process.kill(-child.pid,'SIGKILL'); } catch {}
  }
}
(async()=>{
  try {
    await launch(async run=>{
      const keys=await run('dainami.keysGet()'); assert.equal(keys.ok,true,'real safeStorage is available');
      assert.equal((await run('dainami.keysReveal("SMOKE_KEY")')).value,secret);
      assert.ok(!JSON.stringify(keys).includes(secret));
      // A malformed entry is skipped by name, stays in settings.json, and does not block migration.
      assert.deepEqual(keys.skippedKeys,['BAD-NAME']); assert.ok(!JSON.stringify(keys).includes(skipped));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'settings.json'),'utf8')).envKeys,{'BAD-NAME':skipped});
      for(const expression of ['dainami.boot()','dainami.settingsGet()','dainami.themeSet("glass")','dainami.viewSet("desk")','dainami.settingsSet({openaiModel:"whisper-1"})']) assert.ok(!JSON.stringify(await run(expression)).includes(secret));
      await until(()=>run('!!document.querySelector("#btn-settings")'),'Settings button');
      await run('document.querySelector("#btn-settings").click()');
      await until(()=>run('!!document.querySelector("[data-sec=keys]")'),'Keys tab');
      await run('document.querySelector("[data-sec=keys]").click()');
      await until(()=>run('!!document.querySelector("#key-new-save")'),'Keys controls');
      await until(()=>run('!!document.querySelector("#keys-skipped-warning")'),'skipped-entry warning');
      assert.ok((await run('document.querySelector("#keys-skipped-warning").innerText')).includes('BAD-NAME'));
      assert.ok(!(await run('document.querySelector("#set-pane").innerText')).includes(skipped));
      await run(`document.querySelector('#key-new-name').value='UI_KEY'; document.querySelector('#key-new-val').value=${JSON.stringify(secret)}; document.querySelector('#key-new-save').click()`);
      await until(()=>run(`!!document.querySelector('[data-key="UI_KEY"] [data-act="show"]')`),'saved key row');
      assert.ok(!(await run('document.querySelector("#set-pane").innerText')).includes(secret));
      await run(`document.querySelector('[data-key="UI_KEY"] [data-act="show"]').click()`);
      await until(async()=>(await run('document.querySelector("#set-pane").innerText')).includes(secret),'deliberate Show');
      await run(`document.querySelector('[data-key="UI_KEY"] [data-act="hide"]').click()`);
      assert.ok(!(await run('document.querySelector("#set-pane").innerText')).includes(secret));
      await run(`document.querySelector('[data-key="UI_KEY"] [data-act="edit"]').click()`);
      await run(`document.querySelector('#key-edit-val').value=${JSON.stringify(saved)}; document.querySelector('[data-key="UI_KEY"] [data-act="save"]').click()`);
      await until(async()=>(await run('dainami.keysReveal("UI_KEY")')).value===saved,'edited key');
      await run(`document.querySelector('[data-key="UI_KEY"] [data-act="remove"]').click()`);
      await until(async()=>(await run('dainami.keysReveal("UI_KEY")')).value==='','removed key');
      assert.equal((await run(`dainami.keysSet("RESTART_KEY",${JSON.stringify(saved)})`)).ok,true);
      assert.equal((await run('dainami.keysDelete("SMOKE_KEY")')).ok,true);
      assert.equal((await run('dainami.keysDelete("legacy:sttKey")')).ok,true);
      // Correcting the skipped name must encrypt its value before removing it.
      fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({theme:'glass',envKeys:{RECOVERED_KEY:skipped}}));
      await run('document.querySelector("#keys-retry").click()');
      await until(()=>run('!document.querySelector("#keys-skipped-warning")'),'corrected entry recovered');
      assert.equal((await run('dainami.keysReveal("RECOVERED_KEY")')).value,skipped);
      assert.ok(!fs.readFileSync(path.join(profile,'settings.json'),'utf8').includes(skipped));
      assert.ok(!fs.readFileSync(path.join(profile,'settings.json'),'utf8').includes(secret));
      assert.ok(!fs.readFileSync(path.join(profile,'credentials.json'),'utf8').includes(secret));
      assert.equal(fs.statSync(path.join(profile,'credentials.json')).mode & 0o777,0o600);
    });
    console.log('PASS: actual safeStorage migration, masking, Reveal, saves, deletion, IPC sanitization and permissions');
    await launch(async run=>{
      assert.equal((await run('dainami.keysReveal("RESTART_KEY")')).value,saved);
      assert.equal((await run('dainami.keysReveal("RECOVERED_KEY")')).value,skipped);
      assert.equal((await run('dainami.keysReveal("SMOKE_KEY")')).value,'');
      assert.equal((await run('dainami.keysReveal("legacy:sttKey")')).value,'');
      assert.equal((await run('dainami.keysDelete("RESTART_KEY")')).ok,true);
    });
    await launch(async run=>{ assert.equal((await run('dainami.keysReveal("RESTART_KEY")')).value,''); });
    console.log('PASS: actual encrypted persistence and deletion across three app launches; Settings add/show/hide/edit/remove');
    const vault=path.join(profile,'credentials.json'), recoverable=fs.readFileSync(vault);
    fs.writeFileSync(vault,'invalid ciphertext fixture');
    await launch(async run=>{
      assert.equal((await run('dainami.keysGet()')).ok,false);
      assert.equal((await run('dainami.keysSet("BLOCKED_KEY","dummy")')).ok,false);
      // Agent account probes are covered offline with injected dependencies.
      const speech=await run('dainami.sttStatus()');
      assert.ok(Array.isArray(speech.providers)&&speech.credentialStorage&&speech.credentialStorage.ok===false,'speech status with damaged vault');
      await until(()=>run('!!document.querySelector("#btn-settings")'),'Settings button');
      await run('document.querySelector("#btn-settings").click()');
      await until(()=>run('!!document.querySelector("[data-sec=keys]")'),'Keys tab');
      await run('document.querySelector("[data-sec=keys]").click()');
      await until(()=>run('!!document.querySelector("#keys-retry")'),'recovery control');
      assert.equal(fs.readFileSync(vault,'utf8'),'invalid ciphertext fixture');
      fs.writeFileSync(vault,recoverable);
      await run('document.querySelector("#keys-retry").click()');
      await until(()=>run('!!document.querySelector("#key-new-save")'),'recovered Keys controls');
      assert.equal((await run('dainami.keysGet()')).ok,true);
      // A write failure in an already-open Keys pane must expose Retry too.
      fs.writeFileSync(vault,'damaged-while-running');
      await run(`document.querySelector('#key-new-name').value='FAILED_SAVE'; document.querySelector('#key-new-val').value=${JSON.stringify(saved)}; document.querySelector('#key-new-save').click()`);
      await until(()=>run('!!document.querySelector("#keys-retry")'),'Retry after failed save');
      assert.ok(!(await run('document.querySelector("#set-pane").innerText')).includes(saved));
      assert.equal(fs.readFileSync(vault,'utf8'),'damaged-while-running');
      const recoverySource=JSON.stringify({theme:'glass',envKeys:{RECOVERED_KEY:skipped}});
      fs.writeFileSync(path.join(profile,'settings.json'),recoverySource);
      const refused=await run('dainami.keysRetry()');
      assert.equal(refused.cleanupPending,true);
      assert.ok(refused.cleanupWarning.includes('credentials.json'));
      assert.equal(fs.readFileSync(path.join(profile,'settings.json'),'utf8'),recoverySource);
      assert.equal((await run('dainami.keysReveal("RECOVERED_KEY")')).value,skipped);

      fs.writeFileSync(vault,recoverable);
      await run('document.querySelector("#keys-retry").click()');
      await until(()=>run('!document.querySelector("#keys-cleanup-warning") && !!document.querySelector("#key-new-save")'),'Retry after failed save recovers');
      assert.equal((await run('dainami.keysReveal("FAILED_SAVE")')).value,'');
      // A completed vault stays usable when disposable settings cannot be parsed.
      const settingsFile=path.join(profile,'settings.json');
      fs.writeFileSync(settingsFile,'unreadable settings fixture');
      await run(`document.querySelector('#key-new-name').value='CLEANUP_KEY'; document.querySelector('#key-new-val').value=${JSON.stringify(saved)}; document.querySelector('#key-new-save').click()`);
      await until(()=>run('!!document.querySelector("#keys-cleanup-warning")'),'cleanup warning after committed save');
      const warned=await run('dainami.keysGet()');
      assert.equal(warned.ok,true); assert.equal(warned.cleanupPending,true);
      assert.ok(!JSON.stringify(warned).includes(saved));
      assert.equal((await run('dainami.keysReveal("CLEANUP_KEY")')).value,saved);
      assert.equal(await run('document.querySelector("#keys-retry").textContent'),'Retry cleanup');
      assert.ok(await run('!!document.querySelector("#keys-show-settings") && !!document.querySelector("#key-new-save")'));
      await run(`document.querySelector('[data-key="CLEANUP_KEY"] [data-act="remove"]').click()`);
      await until(()=>run('document.querySelector("#toast-root").textContent.includes("Removed from encrypted storage; plaintext cleanup is incomplete")'),'truthful deletion notification');
      assert.equal((await run('dainami.keysReveal("CLEANUP_KEY")')).value,'');
      assert.equal(fs.readFileSync(settingsFile,'utf8'),'unreadable settings fixture');
      fs.writeFileSync(settingsFile,JSON.stringify({theme:'dusk',envKeys:{CLEANUP_KEY:saved}}));
      await run('document.querySelector("#keys-retry").click()');
      await until(()=>run('!document.querySelector("#keys-cleanup-warning") && !!document.querySelector("#key-new-save")'),'cleanup retry clears warning');
      const cleaned=await run('dainami.keysGet()');
      assert.equal(cleaned.cleanupPending,false); assert.equal(cleaned.cleanupWarning,null);
      assert.equal((await run('dainami.keysReveal("CLEANUP_KEY")')).value,'');
      assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile,'utf8')),{theme:'dusk'});
      // Migration is complete, so a damaged preferences file self-heals on the next save.
      fs.writeFileSync(settingsFile,'damaged preferences fixture');
      assert.equal((await run('dainami.settingsSet({openaiModel:"whisper-1"})')).ok,true);
      assert.equal(JSON.parse(fs.readFileSync(settingsFile,'utf8')).openaiModel,'whisper-1');
      assert.equal((await run('dainami.keysReveal("RESTART_KEY")')).value,'');
    });
    console.log('PASS: corrupt vault recovery; incomplete cleanup warns with usable keys; deletion notice and Retry cleanup remove stale plaintext; damaged preferences self-heal after migration');
  } catch(error) {
    // Assertions can contain actual values; keep fixture diagnostics secret-free.
    console.error('FAIL: '+String(error.message).replaceAll(secret,'[redacted]').replaceAll(saved,'[redacted]').replaceAll(skipped,'[redacted]'));
    process.exitCode=1;
  } finally { fs.rmSync(temp,{recursive:true,force:true,maxRetries:5}); }
})();
