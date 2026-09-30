import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createHash, createPublicKey, randomBytes, scrypt as scryptCallback, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const scrypt=promisify(scryptCallback);
const hash=(value)=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const validEmail=(value)=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword=(value)=>typeof value==='string'&&value.length>=12&&value.length<=128;

async function passwordHash(password,salt){return (await scrypt(password,Buffer.from(salt,'hex'),64)).toString('hex')}
function equalHex(left,right){const a=Buffer.from(left??'','hex'),b=Buffer.from(right??'','hex');return a.length>0&&a.length===b.length&&timingSafeEqual(a,b)}
function send(response,status,data){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(data))}
async function readJson(request){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>10_000_000)throw new Error('Request exceeds 10 MB');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}

export function createAccountServer({dbPath=resolve('data/mainsagents-accounts.sqlite'),host='127.0.0.1',port=8790,tlsKeyFile,tlsCertFile,googleClientId=process.env.MAINSAGENTS_GOOGLE_CLIENT_ID??''}={}){
  if(host!=='127.0.0.1'&&host!=='::1'&&(!tlsKeyFile||!tlsCertFile))throw new Error('Public binding requires TLS key and certificate files');
  mkdirSync(dirname(dbPath),{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,recovery_hash TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS google_identities(google_sub TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL);');
  const attempts=new Map();
  const limited=(key)=>{const now=Date.now();const item=attempts.get(key)??{count:0,reset:now+15*60_000};if(now>item.reset){item.count=0;item.reset=now+15*60_000}item.count++;attempts.set(key,item);return item.count>12};
  const authenticate=(request)=>{const raw=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];if(!raw)return null;const row=db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=?').get(hash(raw));return row&&row.expires_at>Date.now()?row.user_id:null};
  const issueSession=(userId)=>{const raw=token();db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(raw),userId,Date.now()+30*24*60*60_000);return raw};
  let googleKeys;
  let googleKeysExpires=0;
  const verifyGoogleIdToken=async(idToken,nonce)=>{
    if(!googleClientId)throw new Error('Google sign-in needs to be configured by the app developer.');
    if(typeof idToken!=='string'||idToken.length>16_384)throw new Error('Invalid Google sign-in response');
    const parts=idToken.split('.');if(parts.length!==3)throw new Error('Invalid Google sign-in response');
    let header,claims;try{header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'))}catch{throw new Error('Invalid Google sign-in response')}
    if(header.alg!=='RS256'||typeof header.kid!=='string')throw new Error('Unsupported Google sign-in token');
    if(!googleKeys||Date.now()>googleKeysExpires){const response=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Could not verify the Google account');const result=await response.json();googleKeys=result.keys;googleKeysExpires=Date.now()+Math.min(3600,Math.max(60,Number.parseInt(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]??'3600',10)))*1000}
    const jwk=googleKeys?.find((key)=>key.kid===header.kid&&key.kty==='RSA');if(!jwk)throw new Error('Could not verify the Google account');
    const valid=verifySignature('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url'));
    const now=Math.floor(Date.now()/1000);if(!valid||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==googleClientId||Number(claims.exp)<=now||Number(claims.iat)>now+60||claims.nonce!==nonce||claims.email_verified!==true||typeof claims.sub!=='string'||!validEmail(claims.email))throw new Error('Google could not verify this account');
    return {googleSub:claims.sub,email:claims.email.trim().toLowerCase()};
  };
  const handler=async(request,response)=>{
    const url=new URL(request.url??'/',`http://${request.headers.host??'localhost'}`);
    try{
      if(request.method==='GET'&&url.pathname==='/api/health')return send(response,200,{ready:true});
      if(request.method==='POST'&&url.pathname==='/api/auth/register'){
        if(limited(`register:${request.socket.remoteAddress}`))return send(response,429,{error:'Try again later'});
        const input=await readJson(request);const email=String(input.email??'').trim().toLowerCase();
        if(!validEmail(email)||!validPassword(input.password))return send(response,400,{error:'Valid email and a password of 12–128 characters are required'});
        if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return send(response,409,{error:'An account already uses this email'});
        const salt=randomBytes(16).toString('hex'),recoveryCode=token(),userId=token();
        db.prepare('INSERT INTO users(id,email,password_hash,salt,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').run(userId,email,await passwordHash(input.password,salt),salt,hash(recoveryCode),new Date().toISOString());
        return send(response,201,{token:issueSession(userId),email,userId,recoveryCode});
      }
      if(request.method==='POST'&&url.pathname==='/api/auth/google'){
        if(limited(`google:${request.socket.remoteAddress}`))return send(response,429,{error:'Try again later'});
        const input=await readJson(request);const identity=await verifyGoogleIdToken(input.idToken,input.nonce);
        let row=db.prepare('SELECT user_id FROM google_identities WHERE google_sub=?').get(identity.googleSub);
        let recoveryCode;
        if(!row){
          let user=db.prepare('SELECT id FROM users WHERE email=?').get(identity.email);
          if(!user){const userId=token(),salt=randomBytes(16).toString('hex');recoveryCode=token();db.prepare('INSERT INTO users(id,email,password_hash,salt,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').run(userId,identity.email,await passwordHash(token(),salt),salt,hash(recoveryCode),new Date().toISOString());user={id:userId}}
          db.prepare('INSERT INTO google_identities(google_sub,user_id,created_at) VALUES(?,?,?)').run(identity.googleSub,user.id,new Date().toISOString());row={user_id:user.id};
        }
        return send(response,200,{token:issueSession(row.user_id),email:identity.email,userId:row.user_id,recoveryCode});
      }
      if(request.method==='POST'&&url.pathname==='/api/auth/login'){
        if(limited(`login:${request.socket.remoteAddress}`))return send(response,429,{error:'Try again later'});
        const input=await readJson(request);const email=String(input.email??'').trim().toLowerCase();
        const row=db.prepare('SELECT id,password_hash,salt FROM users WHERE email=?').get(email);
        if(!row||!equalHex(await passwordHash(String(input.password??''),row.salt),row.password_hash))return send(response,401,{error:'Invalid email or password'});
        return send(response,200,{token:issueSession(row.id),email,userId:row.id});
      }
      if(request.method==='POST'&&url.pathname==='/api/auth/recover'){
        if(limited(`recover:${request.socket.remoteAddress}`))return send(response,429,{error:'Try again later'});
        const input=await readJson(request);const email=String(input.email??'').trim().toLowerCase();
        if(!validPassword(input.newPassword))return send(response,400,{error:'Password must have 12–128 characters'});
        const row=db.prepare('SELECT id,recovery_hash FROM users WHERE email=?').get(email);
        if(!row||!equalHex(hash(String(input.recoveryCode??'')),row.recovery_hash))return send(response,401,{error:'Invalid recovery details'});
        const salt=randomBytes(16).toString('hex'),nextRecoveryCode=token();
        db.prepare('UPDATE users SET password_hash=?,salt=?,recovery_hash=? WHERE id=?').run(await passwordHash(input.newPassword,salt),salt,hash(nextRecoveryCode),row.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
        return send(response,200,{token:issueSession(row.id),email,userId:row.id,recoveryCode:nextRecoveryCode});
      }
      const userId=authenticate(request);
      if(!userId)return send(response,401,{error:'Sign in required'});
      if(request.method==='GET'&&url.pathname==='/api/auth/me'){const row=db.prepare('SELECT email,id FROM users WHERE id=?').get(userId);return send(response,200,{email:row.email,userId:row.id})}
      if(request.method==='POST'&&url.pathname==='/api/auth/logout'){const raw=request.headers.authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(raw));return send(response,200,{ok:true})}
      if(request.method==='DELETE'&&url.pathname==='/api/auth/account'){
        const input=await readJson(request);const row=db.prepare('SELECT password_hash,salt FROM users WHERE id=?').get(userId);
        if(!equalHex(await passwordHash(String(input.password??''),row.salt),row.password_hash))return send(response,401,{error:'Invalid password'});
        db.prepare('DELETE FROM users WHERE id=?').run(userId);return send(response,200,{deleted:true});
      }
      return send(response,404,{error:'Not found'});
    }catch(error){return send(response,error instanceof SyntaxError?400:500,{error:error instanceof Error?error.message:'Request failed'})}
  };
  const server=tlsKeyFile&&tlsCertFile?createSecureServer({key:readFileSync(tlsKeyFile),cert:readFileSync(tlsCertFile)},handler):createServer(handler);
  return {listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve(server.address())})}),close:()=>new Promise((resolve)=>server.close(()=>{db.close();resolve()}))};
}

if(process.argv[1]&&import.meta.url===new URL(`file:///${process.argv[1].replaceAll('\\','/')}`).href){const service=createAccountServer({dbPath:resolve(process.env.MAINSAGENTS_ACCOUNT_DB??'data/mainsagents-accounts.sqlite'),host:process.env.MAINSAGENTS_ACCOUNT_HOST??'127.0.0.1',port:Number(process.env.MAINSAGENTS_ACCOUNT_PORT??8790),tlsKeyFile:process.env.MAINSAGENTS_TLS_KEY,tlsCertFile:process.env.MAINSAGENTS_TLS_CERT});service.listen().then((address)=>console.log(`MainsAgents account service ready on ${address.address}:${address.port}`)).catch((error)=>{console.error(error);process.exitCode=1})}
