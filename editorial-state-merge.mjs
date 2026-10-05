const missing=Symbol('missing');
const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
const equal=(a,b)=>a===b||a!==missing&&b!==missing&&JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
const object=value=>value!==missing&&value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Merge disjoint edits only. Conflicts keep the local draft and never overwrite the service. */
export function mergeEditorialState(base,local,remote,path='editorial'){
  if(equal(local,remote)||equal(remote,base))return local;
  if(equal(local,base))return remote;
  if(object(base)&&object(local)&&object(remote)){
    const result={};for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
      const value=mergeEditorialState(key in base?base[key]:missing,key in local?local[key]:missing,key in remote?remote[key]:missing,`${path}.${key}`);if(value!==missing)result[key]=value;
    }return result;
  }
  if([base,local,remote].every(value=>Array.isArray(value)&&value.every(item=>object(item)&&typeof item.id==='string'))){
    const [b,l,r]=[base,local,remote].map(rows=>new Map(rows.map(row=>[row.id,row]))),result=[];
    for(const id of new Set([...l.keys(),...r.keys(),...b.keys()])){const value=mergeEditorialState(b.get(id)??missing,l.get(id)??missing,r.get(id)??missing,`${path}[${id}]`);if(value!==missing)result.push(value);}return result;
  }
  throw new Error(`Saved data changed in ${path}. Your edits were preserved; export a backup before reloading.`);
}
