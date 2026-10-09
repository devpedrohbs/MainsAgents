// Lists local runtime modules reachable from desktop-main.mjs that electron-builder would leave out of the package.
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,normalize} from 'node:path';
const root=join(import.meta.dirname,'..'),packaged=new Set(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).build.files);
const seen=new Set();
const walk=file=>{
 if(seen.has(file))return;seen.add(file);
 for(const match of readFileSync(join(root,file),'utf8').matchAll(/(?:from|import\()\s*['"](\.\.?\/[^'"]+)['"]/g)){
  const target=normalize(join(dirname(file),match[1])).replaceAll('\\','/');
  if(/\.(mjs|cjs)$/.test(target)&&existsSync(join(root,target)))walk(target);
 }
};
walk('desktop-main.mjs');walk('desktop-preload.cjs');
const missing=[...seen].filter(file=>!packaged.has(file));
console.log(JSON.stringify({modules:seen.size,missing}));
if(missing.length)process.exitCode=1;
