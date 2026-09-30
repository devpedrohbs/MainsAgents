import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountServer } from '../cloud-server.mjs';

test('account registration and login do not expose a work history API',async()=>{
  const server=createAccountServer({dbPath:':memory:',port:0});
  const address=await server.listen();
  const base=`http://127.0.0.1:${address.port}`;
  const call=async(path,method='GET',token,data)=>{const response=await fetch(`${base}${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,body:await response.json()}};
  try{
    const first=await call('/api/auth/register','POST',undefined,{email:'first@example.com',password:'first-password-123'});
    const second=await call('/api/auth/register','POST',undefined,{email:'second@example.com',password:'second-password-123'});
    assert.equal(first.status,201);assert.equal(second.status,201);
    assert.ok(first.body.recoveryCode);
    assert.notEqual(first.body.userId,second.body.userId);
    assert.equal((await call('/api/auth/me','GET',first.body.token)).body.userId,first.body.userId);
    assert.equal((await call('/api/sync','GET',first.body.token)).status,404);
    const loggedIn=await call('/api/auth/login','POST',undefined,{email:'first@example.com',password:'first-password-123'});
    assert.equal(loggedIn.status,200);assert.equal(loggedIn.body.userId,first.body.userId);
  }finally{await server.close()}
});

test('recovery rotates the code and revokes earlier sessions',async()=>{
  const server=createAccountServer({dbPath:':memory:',port:0});
  const address=await server.listen();const base=`http://127.0.0.1:${address.port}`;
  const call=async(path,method='GET',token,data)=>{const response=await fetch(`${base}${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,body:await response.json()}};
  try{
    const registered=await call('/api/auth/register','POST',undefined,{email:'recover@example.com',password:'old-password-123'});
    const recovered=await call('/api/auth/recover','POST',undefined,{email:'recover@example.com',recoveryCode:registered.body.recoveryCode,newPassword:'new-password-123'});
    assert.equal(recovered.status,200);
    assert.notEqual(recovered.body.recoveryCode,registered.body.recoveryCode);
    assert.equal((await call('/api/auth/me','GET',registered.body.token)).status,401);
    assert.equal((await call('/api/auth/me','GET',recovered.body.token)).status,200);
  }finally{await server.close()}
});
