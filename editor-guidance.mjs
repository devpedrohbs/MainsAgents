import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';

/**
 * Editing guidance for the editor-authoring session (contract mainsagents.editor-authoring/1): the app's default visual/sound
 * guide plus the editor agent's ENABLED skills. Read by the HOST only from the files configured on the agent snapshot
 * (agent.skillFiles of agent.skills minus disabledSkills, inside agent.skillsDirectory when set), bounded in bytes, and handed
 * to the model as reference data. It grants no tool, file access or permission; the plan stays validated data.
 */
export const GUIDANCE_LIMITS=Object.freeze({maxFileBytes:16_000,maxTotalBytes:48_000,maxFiles:8,maxReadBytes:1_000_000});
export const APP_GUIDE_NAME='mainsagents-guia-creator-tech';

/** Original default guide of the app (not a copy of any paid guide). Content-specific references prevail for that piece only. */
export const APP_GUIDE=`# Guia visual e sonoro padrão — creator de tecnologia (MainsAgents)
Guia original do app. Referência, cores ou pedidos do conteúdo atual (briefing/ajustes) prevalecem SOMENTE nesta peça; skills do agente prevalecem sobre este guia.

## Intenção
A fala do criador manda; o visual explica o que é dito com animações e telas reais (números, passos, comparações, prova). Nada decorativo sem função.
Cada caixa de conteúdo pode pedir um estilo novo: não repita automaticamente o visual de outra peça.

## Hierarquia
- Título curto só QUANDO ajudar a entender (conceito, número, etapa, prova, comparação); não é obrigatório por ideia nem por cena. Apoio menor; no máximo dois níveis de texto visíveis ao mesmo tempo.
- storyboard.style.treatment "creator" por padrão ("editorial"/"technical" se o conteúdo pedir). Fontes do sistema.
- Uma cor de acento (style.accent), trocada por conteúdo quando a peça pedir; accent2 só para contraste/comparação.

## Quatro layouts com as capacidades atuais
- fala: camera.layout "full", sem camadas além do necessário; a faixa inferior fica livre (o usuário aplica a legenda do SRT no CapCut).
- fala+UI: "full" + um elemento pequeno (label, callout, counter, chapter) em slot de topo/canto, fora da faixa inferior.
- split: "split-top" (vertical) ou "split-left"/"split-right" (horizontal) + painel com steps, process, compare, bars ou image.
- fullscreen: "hidden" + background + image/video (tela real) ou texto grande, curto, voltando ao criador.
Criador visível no gancho e no fechamento/CTA. Troque de layout pela fala, não por relógio.

## Prova visual
- Prefira capturas reais da ferramenta citada (assets do conteúdo, por assetId) a ícones genéricos; sem asset, use texto/steps e não invente interface.
- Fluxos de 2 a 4 passos; números e citações só com fonte (transcrição, briefing ou texto do usuário).

## Movimento
- Curto e funcional: entrada rápida, destaque ancorado na palavra dita (get_transcript_words), saída limpa, um foco por vez.
- Câmera/zoom só para ênfase. Preserve luz e cor da gravação: não escureça, desfoque nem altere a cor do vídeo do criador.

## Cortes
- Remova pausas longas, falsos inícios e repetições quando palavras/tempos e frames mostrarem com clareza; preserve respiração, ênfase e sentido. Na dúvida, mantenha e confira no preview.

## Som (capacidade atual deste fluxo)
- Disponível: storyboard.sfx whoosh/pop/tick sintetizados localmente (ganho -36 a -10 dB, até 6 por minuto, 1,5 s entre eles) e normalizeAudio. Não há biblioteca licenciada nem trilha aqui.
- Som só ligado a evento visual (entrada de painel, item de lista); voz sempre dominante; menos é melhor.

## Legendas e texto na tela
- NÃO transcreva a fala na composição: nada de legenda/transcrição em camadas (kineticText/label repetindo o que é dito) e nada de legenda gravada no vídeo por padrão.
- As legendas da fala ficam num arquivo .srt separado e editável (blocos curtos, ~3 palavras) que o usuário gera ou importa no Estúdio ("Legendas SRT para o CapCut") e leva ao mesmo projeto do CapCut. Não diga que um SRT foi entregue se você só planejou: arquivo entregue é só o que tem recibo real. Gravar legenda na imagem só acontece se o usuário pedir explicitamente.
- Texto na tela só quando for muito útil: explicar um conceito, um número, uma etapa, uma prova ou uma comparação — curto e ancorado na palavra dita. Na dúvida, use animação ou a tela real em vez de texto.
- Mantenha textos e painéis fora da faixa inferior reservada à legenda do SRT.

## Revisão
- Inspecione todas as cenas e corrija o que estiver ilegível, fora da área segura, fora de sincronia ou poluído. O usuário revisa a prévia/resultado e pode pedir ajustes.`;

const sha=value=>createHash('sha256').update(value).digest('hex');
// Text only: control characters (except tab/newline) and bidi overrides are removed; nothing else is rewritten.
const clean=value=>value.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g,'');
// The result never exceeds `max` bytes, marker included; null when not even a useful excerpt fits.
function bounded(text,max){
 if(Buffer.byteLength(text)<=max)return {text,truncated:false};
 const marker='\n[guia truncado pelo app]',room=max-Buffer.byteLength(marker);if(room<64)return null;
 let cut=Buffer.from(text).subarray(0,room).toString('utf8');if(cut.endsWith('�'))cut=cut.slice(0,-1);
 return {text:cut+marker,truncated:true};
}
const inside=(root,path)=>{const rel=relative(root,path);return rel===''||!!rel&&!rel.startsWith('..')&&!isAbsolute(rel);};

/**
 * Returns {items:[{name,origin,sha256,bytes,truncated,text}],skipped:[{name,reason}],hash}. `items[0]` is the app guide unless
 * appGuide is false. Never throws for a bad skill file: it is skipped with the reason (shown to the model and audited).
 */
export function loadEditorGuidance(agent,{appGuide=true,limits=GUIDANCE_LIMITS,read=readFileSync,stat=statSync,realpath=realpathSync}={}){
 const items=[],skipped=[];let total=0;
 const add=(name,origin,raw)=>{
  const text=clean(raw),value=bounded(text,Math.min(limits.maxFileBytes,limits.maxTotalBytes-total));
  if(!value){skipped.push({name,reason:'limite total de bytes da orientação'});return;}
  total+=Buffer.byteLength(value.text);
  items.push({name,origin,sha256:sha(raw),bytes:Buffer.byteLength(raw),truncated:value.truncated,text:value.text});
 };
 if(appGuide)add(APP_GUIDE_NAME,'app-guide',APP_GUIDE);
 const disabled=new Set(Array.isArray(agent?.disabledSkills)?agent.disabledSkills:[]);
 const names=(Array.isArray(agent?.skills)?agent.skills:[]).filter(name=>typeof name==='string'&&name&&!disabled.has(name));
 let root=null;
 if(typeof agent?.skillsDirectory==='string'&&agent.skillsDirectory.trim()){try{root=realpath(resolve(agent.skillsDirectory.trim()));}catch{root=undefined;}}
 for(const name of [...new Set(names)]){
  if(items.length-(appGuide?1:0)>=limits.maxFiles){skipped.push({name,reason:'limite de skills na orientação'});continue;}
  const path=agent?.skillFiles?.[name];
  if(typeof path!=='string'||!isAbsolute(path)||!/\.md$/i.test(path)){skipped.push({name,reason:'sem arquivo .md configurado'});continue;}
  if(root===undefined){skipped.push({name,reason:'pasta de skills configurada indisponível'});continue;}
  let real;try{real=realpath(path);}catch{skipped.push({name,reason:'arquivo não encontrado'});continue;}
  if(root&&!inside(root,real)){skipped.push({name,reason:'arquivo fora da pasta de skills configurada'});continue;}
  let info;try{info=stat(real);}catch{skipped.push({name,reason:'arquivo não encontrado'});continue;}
  if(!info.isFile()||info.size>limits.maxReadBytes){skipped.push({name,reason:'arquivo inválido ou grande demais'});continue;}
  let raw;try{raw=String(read(real,'utf8'));}catch{skipped.push({name,reason:'arquivo ilegível'});continue;}
  add(name,'agent-skill',raw);
 }
 return {items,skipped,hash:sha(JSON.stringify(items.map(item=>[item.name,item.sha256,item.truncated])))};
}
