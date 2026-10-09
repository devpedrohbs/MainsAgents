// Stages the verified local whisper.cpp tools for the desktop package (electron-builder extraResources).
// Copies only files whose SHA-256 matches the pinned official whisper.cpp v1.7.6 Windows x64 release and ggml-base model.
// Never downloads. Missing or mismatched tools produce a manifest with available:false, so the app reports the absence.
// Source: MAINSAGENTS_WHISPER_SOURCE or .mainsagents-workspaces/tooling/whispercpp. Output: build-resources/whispercpp.
import {createHash} from 'node:crypto';
import {createReadStream,existsSync} from 'node:fs';
import {copyFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const source=resolve(process.env.MAINSAGENTS_WHISPER_SOURCE??join(root,'.mainsagents-workspaces','tooling','whispercpp'));
const target=join(root,'build-resources','whispercpp');
// whisper.cpp v1.7.6 whisper-bin-x64.zip (Release/*) and ggml-base.bin from huggingface.co/ggerganov/whisper.cpp (sha1 465707469f…).
export const pinnedWhisperFiles=Object.freeze({
  'bin/Release/whisper-cli.exe':'b7c6dc2e999a80bc2d23cd4c76701211f392ae55d5cabdf0d45eb2ca4faf09af',
  'bin/Release/whisper.dll':'bbeceed370799687a363244edc583bac3dc5d472f5bd14691a26f22c7e710bb8',
  'bin/Release/ggml.dll':'f91ef57cfd6d2f07a5fc33e5dca114b3dc3abe8495f47b46dfbe178d6d775c37',
  'bin/Release/ggml-base.dll':'e912e19071c32d673a81de4aab058d36328cc6b0c59c75889a0ba4c65fd6a4e6',
  'bin/Release/ggml-cpu.dll':'341ed96e2520ef9b44509f18b5ac4f60d171e47a6c55ab390d704ea7b06ae617',
  'ggml-base.bin':'60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
});
const licenses=`whisper.cpp v1.7.6 — MIT License, Copyright (c) 2023-2024 The ggml authors. https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE
ggml-base.bin — OpenAI Whisper "base" weights converted to ggml; OpenAI Whisper is MIT licensed. https://github.com/openai/whisper/blob/main/LICENSE
Files are copied unchanged and verified by SHA-256 (see MANIFEST.json). Used only for local, offline transcription.
`;
const sha256=path=>new Promise((done,fail)=>{const hash=createHash('sha256');createReadStream(path).on('data',chunk=>hash.update(chunk)).on('error',fail).on('end',()=>done(hash.digest('hex')));});

const files=[],problems=[];
for(const [name,expected] of Object.entries(pinnedWhisperFiles)){
  const from=join(source,name);
  if(!existsSync(from)){problems.push(`${name} ausente em ${source}`);continue;}
  const actual=await sha256(from);if(actual!==expected){problems.push(`${name} sha256 ${actual.slice(0,12)}… diferente do fixado`);continue;}
  files.push({name,sha256:actual,from});
}
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
const available=problems.length===0;
if(available)for(const file of files){const to=join(target,file.name);await mkdir(dirname(to),{recursive:true});await copyFile(file.from,to);if(await sha256(to)!==file.sha256)throw Error(`Copy of ${file.name} failed verification.`);}
await writeFile(join(target,'MANIFEST.json'),JSON.stringify({engine:'whisper.cpp',version:'1.7.6',model:'ggml-base',available,reasons:problems,files:available?files.map(({name,sha256})=>({name,sha256})):[],stagedAt:new Date().toISOString()},null,2));
await writeFile(join(target,'THIRD-PARTY-LICENSES.txt'),licenses);
console.log(available?`Whisper tools staged and verified in ${target}`:`Whisper tools NOT staged (${problems.join('; ')}). The app will report local transcription as unavailable.`);
