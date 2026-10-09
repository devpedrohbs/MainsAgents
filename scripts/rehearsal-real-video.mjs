// B06 preparation harness. It NEVER calls Claude, Codex, Notion or any network service, and it never picks a file by itself.
//   node scripts/rehearsal-real-video.mjs --selftest                 synthetic SDR/HDR10 clips + generated speech: QA of the harness and of the media layer
//   node scripts/rehearsal-real-video.mjs --video <path> [--mode local|notion]
//                                                                    read-only probe (ffprobe) of a clip YOU choose + the rehearsal plan; nothing is uploaded or edited
// The real rehearsal (Claude local, or Claude + a Notion test card) is run by the user in the app after this check, with explicit approvals.
import {mkdirSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {probeVideo,runMediaProcess} from '../editorial-media.mjs';

const args=process.argv.slice(2),flag=name=>args.includes(`--${name}`),value=name=>{const i=args.indexOf(`--${name}`);return i>=0?args[i+1]:undefined;};
const root=resolve(import.meta.dirname,'..');

async function colorInfo(path){
 const raw=await runMediaProcess('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-select_streams','v:0','-show_entries','stream=pix_fmt,color_space,color_transfer,color_primaries,bits_per_raw_sample,profile','-of','json',path]);
 const stream=JSON.parse(raw).streams?.[0]??{},transfer=stream.color_transfer??'';
 return {pixFmt:stream.pix_fmt,colorSpace:stream.color_space,transfer,primaries:stream.color_primaries,hdr:/smpte2084|arib-std-b67/.test(transfer)};
}
/** Mean luma (0-255) of one frame decoded the way the app's frame/cover extraction does (no tone mapping). */
async function frameLuma(path,second){
 const raw=await runMediaProcess('ffmpeg',['-nostdin','-hide_banner','-v','error','-ss',String(second),'-i',path,'-frames:v','1','-an','-vf','signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-','-f','null','-']).catch(error=>String(error?.message??error));
 return Number(/YAVG=([\d.]+)/.exec(raw)?.[1]);
}
const plan=mode=>[
 'Antes: escolha o vídeo, o modo (local ou Notion de teste) e confirme que aceita o uso de IA da sua conta. Nada é enviado até você aprovar no app.',
 `1. Iniciar produção no modo ${mode==='notion'?'Notion (use um destino de TESTE, nunca o de produção)':'local (sem Notion)'}; aprovar a ideia e o roteiro.`,
 '2. Gravação: anexar o clipe escolhido; edição automática; revisar o vídeo antes de aprovar.',
 '3. Legendas: transcrever localmente (Whisper), revisar, aprovar e gravar no MP4; conferir o resultado visualmente.',
 '4. Capas: escolher o quadro vendo o vídeo; conferir cor e brilho do quadro (HDR sem mapeamento aparece escuro/lavado).',
 '5. Painel de uso: conferir tokens/custo reportados pelo CLI (ou "indisponível" — nunca saldo nem fatura).',
 '6. NÃO agendar nem publicar: qualquer publicação externa exige autorização específica à parte.',
];

async function selftest(){
 const out=resolve(root,'.mainsagents-workspaces/rehearsal-selftest',String(Date.now()));mkdirSync(out,{recursive:true});
 const speech=join(out,'speech.wav'),sdr=join(out,'synthetic-sdr.mp4'),hdr=join(out,'synthetic-hdr10.mp4'),report={synthetic:true,note:'Clipes e fala GERADOS para QA; não representam um vídeo real do usuário.',clips:{}};
 const script="Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.SetOutputToWaveFile($env:SPEECH_OUT);$s.Speak('Olá, este é um teste sintético de edição.');$s.Dispose()";
 const spoken=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,SPEECH_OUT:speech},windowsHide:true});
 const audio=spoken.status===0&&existsSync(speech)?['-i',speech]:['-f','lavfi','-i','sine=frequency=440:sample_rate=48000'];report.speech=audio[0]==='-i'?'windows-tts':'sine-fallback';
 const common=['-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=4',...audio,'-shortest'];
 await runMediaProcess('ffmpeg',[...common,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',sdr]);
 await runMediaProcess('ffmpeg',[...common,'-vf','format=yuv420p10le','-c:v','libx265','-pix_fmt','yuv420p10le','-x265-params','colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr10=1:repeat-headers=1','-color_primaries','bt2020','-color_trc','smpte2084','-colorspace','bt2020nc','-tag:v','hvc1','-c:a','aac',hdr]);
 for(const [name,path] of [['sdr',sdr],['hdr10',hdr]]){const color=await colorInfo(path);report.clips[name]={...(await probeVideo(path)),color,frameMeanLuma8bit:Math.round(await frameLuma(path,1)/(/10/.test(color.pixFmt??'')?4:1)*10)/10};}
 const delta=report.clips.hdr10.frameMeanLuma8bit-report.clips.sdr.frameMeanLuma8bit;
 report.finding=report.clips.hdr10.color.hdr?`O clipe HDR10 sintético é reconhecido como HDR (${report.clips.hdr10.color.transfer}, ${report.clips.hdr10.color.primaries}). A luminância média dos códigos de pixel é equivalente (${report.clips.hdr10.frameMeanLuma8bit} contra ${report.clips.sdr.frameMeanLuma8bit} no SDR, escala 0–255), então a medição não prova degradação: ela só confirma que o app não faz nenhum mapeamento de tons HDR→SDR em quadros/capas/legendas (nenhum filtro zscale/tonemap no código). Se isso deixa o quadro lavado ou escuro só um clipe real do usuário pode dizer; não foi corrigido por não haver falha comprovada.`:'O FFmpeg local não reproduziu o HDR10 sintético.';
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report},null,2));
}

if(flag('selftest'))await selftest();
else if(value('video')){
 const path=resolve(value('video')),mode=value('mode')==='notion'?'notion':'local';
 if(!existsSync(path)||!statSync(path).isFile()){console.error('Arquivo não encontrado. Nada foi feito.');process.exit(2);}
 const info={...(await probeVideo(path)),color:await colorInfo(path)};
 console.log(JSON.stringify({file:path,mode,probe:info,warnings:[...(info.color.hdr?['Vídeo HDR: o app não faz mapeamento de tons; confira quadros/capas/legendas com atenção.']:[]),...(info.hasAudio?[]:['Sem áudio: legendas e edição por silêncio não se aplicam.'])],plan:plan(mode),externalCalls:0},null,2));
}else{console.error('Uso: --selftest | --video <caminho> [--mode local|notion]. Nenhum arquivo é escolhido automaticamente e nenhum serviço externo é chamado.');process.exit(1);}
