// Runs the shipped worker entrypoint inside Electron, optionally from app.asar.
const {app}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nami-packaged-worker-'));
app.setPath('userData',path.join(directory,'Nami'));
const source={id:'fixture',browser:'Chrome',name:'Fixture',history:path.join(directory,'History')};
const db=new DatabaseSync(source.history);db.exec('CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)');
db.prepare('INSERT INTO urls VALUES(?,?,?)').run('https://example.test/','Fixture',13400000000000000n);db.close();
app.whenReady().then(async()=>{
 let worker;
 try {
  const product=process.env.NAMI_TEST_APP_ASAR?path.resolve(process.env.NAMI_TEST_APP_ASAR):path.resolve(__dirname,'..');
  const {createImportWorker}=require(path.join(product,'src/main/browser-import-worker.js'));
  worker=createImportWorker({source,categories:{history:true,cookies:false,passwords:false},cancelBuffer:new SharedArrayBuffer(4)});
  let copied=0,done=false;
  await new Promise((resolve,reject)=>{
   worker.on('message',m=>{if(m.type==='batch'){copied+=m.rows.length;worker.postMessage({type:'ack'});}if(m.type==='done')done=true;if(m.type==='failure')reject(Error(m.error));});
   worker.on('error',reject);worker.on('exit',code=>code?reject(Error('Worker exit '+code)):resolve());
  });
  assert.equal(done,true);assert.equal(copied,1);await worker.cleanup();
  console.log('PASS: production worker entrypoint loads in Electron, reads real SQLite and acknowledges batches'+(process.env.NAMI_TEST_APP_ASAR?' from app.asar.':'.'));
 }catch(error){console.error(error);process.exitCode=1;}
 finally{await worker?.terminate();await worker?.cleanup();fs.rmSync(directory,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
