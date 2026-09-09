// Plus on a browser tab opens another browser. Companion Agent is gone.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
app.getVersion=()=>require('../package.json').version;
process.argv.push('--demo','--scene=browser','--theme=glass');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
require('../src/main/main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label='state'){const end=Date.now()+20000;while(Date.now()<end){const v=await fn();if(v)return v;await pause(80);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  try{
    const win=await until(()=>BrowserWindow.getAllWindows()[0]);
    const run=js=>win.webContents.executeJavaScript(js);
    const click=sel=>run(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await until(()=>run('!!document.querySelector(".browser-viewport")'),'browser mounted');
    const before=await run('document.querySelectorAll(".companion-tab").length');
    await click('.browser-tile .companion-add');
    await pause(200);
    assert.equal(await run('[...document.querySelectorAll(".browser-menu button")].some(b=>b.textContent==="Agent")'),false,'plus must not offer Agent');
    await until(()=>run(`document.querySelectorAll(".companion-tab").length>${before}`),'new browser tab');
    console.log('PASS: + opens a new browser tab and does not offer a companion Agent.');
    app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
