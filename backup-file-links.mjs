import {statSync} from 'node:fs';
export function inspectBackupFileLinks(paths){
  if(!Array.isArray(paths)||paths.length>1000||paths.some(path=>typeof path!=='string'||path.length>4096))throw new Error('Invalid backup file references.');
  return paths.map(path=>{
    // Inspect local drive paths only; never probe UNC shares or device paths.
    if(!/^[a-z]:[\\/]/i.test(path))return {path,available:false};
    try{const stat=statSync(path);return {path,available:stat.isFile()||stat.isDirectory()}}catch{return {path,available:false}}
  });
}
