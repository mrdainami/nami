const {Worker}=require('node:worker_threads');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
function fixtureWorker(data,options={},onKeychain=()=>{}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nami-import-worker-fixture-'));
  const worker=new Worker(path.join(__dirname,'fixtures/browser-import-worker.cjs'),{workerData:{...data,...options,directory}});
  worker.on('message',m=>{if(m.type==='fixture-keychain')onKeychain();});
  worker.cleanup=()=>fs.promises.rm(directory,{recursive:true,force:true});
  worker.fixtureDirectory=directory;
  return worker;
}
module.exports={fixtureWorker};
