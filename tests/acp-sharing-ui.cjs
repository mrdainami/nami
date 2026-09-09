// Exercise the actual chat pane/composer/client with a deterministic ACP agent.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-acp-sharing-'));
app.setPath('userData', path.join(dir, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await pause(30); } throw new Error('ACP UI condition timed out'); }
app.whenReady().then(async () => {
  let win;
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><body><div id="chat" style="height:480px"></div><div id="fallback" style="height:300px"></div>');
    win = new BrowserWindow({ width: 900, height: 900, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(path.join(dir, 'index.html'));
    const run = code => win.webContents.executeJavaScript(code);
    await run(`(async()=>{
      window.requests=[];window.messages=[];window.contexts=[];window.contextReads=0;window.failImage=true;
      window.dainami={onAcpMsg:cb=>{messages.push(cb);return()=>{}},onAcpErr:()=>()=>{},onAcpExit:()=>()=>{},acpKill:()=>{},acpStart:async()=>({ok:true}),sessionWatchTitle:()=>{},
        acpSend:async({id,payload})=>{requests.push({panelId:id,...payload});let result={};
          if(payload.method==='initialize')result={agentCapabilities:id==='image'?{promptCapabilities:{image:true},mcpCapabilities:{http:true},loadSession:true}:{}};
          if(payload.method==='session/new')result={sessionId:id+'-conversation'};
          if(payload.method==='session/list')result={sessions:[{sessionId:'resumed-conversation',title:'Past conversation'}]};
          setTimeout(()=>{if(payload.method==='session/prompt'){
            for(const [sessionUpdate,text]of [['agent_message_chunk','Visible response'],['agent_thought_chunk','INTERNAL PRIVATE THOUGHT']])messages.forEach(cb=>cb({id,msg:{method:'session/update',params:{update:{sessionUpdate,content:{type:'text',text}}}}}));
          }messages.forEach(cb=>cb({id,msg:{id:payload.id,result}}));},5);return {ok:true};}};
      const {mountChatPane}=await import(${JSON.stringify(pathToFileURL(path.join(__dirname, '../src/renderer/acp-pane.mjs')).href)});
      window.imageRec={body:document.querySelector('#chat')};window.fallbackRec={body:document.querySelector('#fallback')};
      const hooks={open(){},toast(){},contextChanged:(p,record)=>contexts.push({id:p.id,...record}),context:async()=>{contextReads++;return 'Fresh linked source snapshot';},browserConnection:async()=>({url:'http://127.0.0.1:4000/mcp/scoped'}),annotationImage:async()=>{if(failImage)throw new Error('Capture temporarily unavailable');return {type:'image',data:'aW1n',mimeType:'image/png'};}};
      mountChatPane({id:'image',agentId:'codex',title:'Image agent',cwd:'/tmp'},imageRec,hooks);
      mountChatPane({id:'fallback',agentId:'codex',title:'Text agent',cwd:'/tmp'},fallbackRec,hooks);
    })()`);
    await until(() => run('imageRec.acpCapabilities().connected && fallbackRec.acpCapabilities().connected'));
    const result = await run('imageRec.insertSessionDraft({text:"Review this crop",images:[{id:"annotation-1",path:"/private/crop.png",mimeType:"image/png"}]})');
    assert.equal(result.imageMode, 'image');
    assert.equal(await run('requests.filter(r=>r.method==="session/prompt").length'), 0);
    assert.equal(await run('contextReads'), 0);
    await run('document.querySelector("#chat .cw-send").click()');
    await until(() => run('document.querySelector("#chat .cw-in").value==="Review this crop"'));
    assert.equal(await run('document.querySelectorAll("#chat .cw-att .chip").length'), 1, 'image and draft survive preparation failure');
    assert.equal(await run('requests.filter(r=>r.method==="session/prompt").length'), 0);
    await run('failImage=false;document.querySelector("#chat .cw-send").click()');
    await until(() => run('requests.some(r=>r.method==="session/prompt") && !document.querySelector("#chat .cw-send").hidden'));
    const sent = await run('requests.find(r=>r.method==="session/prompt").params.prompt');
    assert.match(sent[0].text, /Fresh linked source snapshot/); assert.deepEqual(sent[1], { type: 'image', data: 'aW1n', mimeType: 'image/png' });
    const context = await run('imageRec.sessionContext()');
    assert.match(context.content, /Review this crop/); assert.match(context.content, /Visible response/); assert.doesNotMatch(context.content, /INTERNAL PRIVATE THOUGHT|Fresh linked/);
    assert.equal(context.identity, 'image-conversation');
    const fallback = await run('fallbackRec.insertSessionDraft({text:"File fallback",images:[{id:"annotation-1",path:"/private/crop.png"}]})');
    assert.equal(fallback.imageMode, 'file-reference');
    await run('document.querySelector("#fallback .cw-send").click()');
    await until(() => run('requests.some(r=>r.panelId==="fallback"&&r.method==="session/prompt")'));
    const fallbackBlocks = await run('requests.find(r=>r.panelId==="fallback"&&r.method==="session/prompt").params.prompt');
    assert.equal(fallbackBlocks.length, 1); assert.match(fallbackBlocks[0].text, /File references: "\/private\/crop.png"/);
    assert.deepEqual(await run('requests.find(r=>r.panelId==="fallback"&&r.method==="session/new").params.mcpServers'), []);
    await run('const input=document.querySelector("#chat .cw-in");input.value="/resume";input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));');
    await until(() => run('!!document.querySelector("#chat .cw-pop .sel")'));
    await run('document.querySelector("#chat .cw-pop .sel").click()');
    await until(() => run('imageRec.sessionContext().identity==="resumed-conversation"'));
    assert.equal(await run('requests.find(r=>r.panelId==="image"&&r.method==="session/load").params.mcpServers[0].name'), 'nami-browser');
    assert.equal(await run('imageRec.sessionContext().content'), '');
    await run('imageRec.disposeRo();fallbackRec.disposeRo()');
    console.log('PASS: actual ACP pane draft insertion without send, negotiated MCP/image blocks, labelled file fallback, preparation failure preserves draft/image, fresh context hook, visible-only recorder and resume identity reset.');
  } catch (error) { console.error(error); if(win)console.error(await win.webContents.executeJavaScript('document.body.textContent')); process.exitCode = 1; }
  finally { win?.destroy(); fs.rmSync(dir, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
});
