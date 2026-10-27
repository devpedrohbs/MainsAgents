import type {ChatActivityItem} from './model/Chat.ts';

/** What one tool step reads like in the chat: the live phrase while it runs, the past phrase once done. */
export interface StepPhrase {live:string;done:string;detail?:string;thinking?:boolean}
export interface LiveRunView {label:string;detail?:string;trail:string[];tone:'work'|'wait'}

const quote=(text:string,pt:boolean)=>pt?`“${text}”`:`“${text}”`;
const titled=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
// Raw provider tool ids (commandExecution, mcpToolCall…) never reach the screen.
const rawTool=(text:string)=>/^[a-z]+[A-Z]\w*$/.test(text)||/^[a-z]+_[a-z_]+$/.test(text);

/**
 * Translates the bridges' step labels (English, sometimes with a query or a server name) into short human phrases.
 * Unknown labels fall back to a neutral "using a tool" so tool noise never shows up raw.
 */
export function stepPhrase(raw:string,pt:boolean):StepPhrase {
  const label=raw.replace(/\s*·\s*interrupted$/i,'').replace(/(\.\.\.|…)$/,'').trim();
  const tool=(livePt:string,donePt:string,liveEn:string,doneEn:string,detail?:string):StepPhrase=>({live:pt?livePt:liveEn,done:pt?donePt:doneEn,...(detail?{detail}:{})});
  if(/^thinking$/i.test(label))return {...tool('Pensando…','Pensou','Thinking…','Thought'),thinking:true};
  let match=/^Searching:\s*(.+)$/i.exec(label);
  if(match)return tool('Buscando na web…',`Buscou ${quote(match[1],pt)}`,'Searching the web…',`Searched ${quote(match[1],pt)}`,quote(match[1],pt));
  if(/^Searching web/i.test(label))return tool('Buscando na web…','Busca feita','Searching the web…','Search done');
  if(/^Searching workspace files/i.test(label))return tool('Procurando nos arquivos…','Procurou nos arquivos','Looking through files…','Looked through files');
  if(/^Reading a web page/i.test(label))return tool('Lendo uma página…','Leu uma página','Reading a page…','Read a page');
  if(/^Reading a file/i.test(label))return tool('Lendo um arquivo…','Leu um arquivo','Reading a file…','Read a file');
  if(/^Reading image/i.test(label))return tool('Vendo a imagem…','Viu a imagem','Looking at the image…','Looked at the image');
  if(/^Using terminal/i.test(label))return tool('Usando o terminal…','Usou o terminal','Using the terminal…','Used the terminal');
  if(/^Preparing file changes/i.test(label))return tool('Preparando arquivos…','Preparou arquivos','Preparing files…','Prepared files');
  if(/^Generating image/i.test(label))return tool('Gerando imagem…','Gerou uma imagem','Generating an image…','Generated an image');
  if(/^Using an installed skill/i.test(label))return tool('Usando uma skill…','Usou uma skill','Using a skill…','Used a skill');
  if(/^Asking the frame reviewer/i.test(label))return tool('Consultando o revisor…','Consultou o revisor','Asking the reviewer…','Asked the reviewer');
  match=/^Using\s+([\w.-]+)\s*(?:·|:)\s*(.+)$/i.exec(label);
  if(match&&!rawTool(match[1])){const name=titled(match[1]);return tool(`Usando o ${name}…`,`Usou o ${name}`,`Using ${name}…`,`Used ${name}`,match[2].replace(/[_-]+/g,' '));}
  match=/^Using\s+(.+)$/i.exec(label);
  if(match&&!rawTool(match[1])&&!/^a tool$/i.test(match[1])){const name=titled(match[1]);return tool(`Usando ${name}…`,`Usou ${name}`,`Using ${name}…`,`Used ${name}`);}
  return tool('Usando uma ferramenta…','Usou uma ferramenta','Using a tool…','Used a tool');
}

/** Short "done" word for the moment between a finished step and the next one: "Busca feita · continuando". */
const settled=(phrase:StepPhrase,pt:boolean)=>/^Bus(cou|ca feita)|^Search/.test(phrase.done)?(pt?'Busca feita':'Search done'):phrase.done;

/**
 * The live line of a running execution, from its real steps: what is happening now, or what just finished while the
 * agent moves on, or that it is writing. Waiting for an approval wins over everything (nothing advances without it).
 */
export function liveRunView(steps:readonly ChatActivityItem[],{writing=false,awaitingApproval=false,pt}:{writing?:boolean;awaitingApproval?:boolean;pt:boolean}):LiveRunView {
  const phrases=steps.map(step=>({step,phrase:stepPhrase(step.label,pt)}));
  const trail:string[]=[];
  for(const {step,phrase} of phrases)if(step.status!=='running'&&!phrase.thinking&&trail.at(-1)!==phrase.done)trail.push(phrase.done);
  const running=[...phrases].reverse().find(({step,phrase})=>step.status==='running'&&!phrase.thinking);
  const last=phrases.at(-1);
  if(awaitingApproval)return {label:pt?'Aguardando sua aprovação':'Waiting for your approval',trail,tone:'wait'};
  if(running)return {label:running.phrase.live,detail:running.phrase.detail,trail,tone:'work'};
  if(writing)return {label:pt?'Escrevendo a resposta…':'Writing the reply…',trail,tone:'work'};
  if(last&&last.step.status!=='running'&&!last.phrase.thinking)return {label:`${settled(last.phrase,pt)} · ${pt?'continuando':'moving on'}`,trail,tone:'work'};
  return {label:pt?'Pensando…':'Thinking…',trail,tone:'work'};
}

/** Distinct finished steps of an execution, in order (the folded list under the final line). */
export function finishedSteps(steps:readonly ChatActivityItem[],pt:boolean):{id:string;text:string;failed:boolean}[] {
  const out:{id:string;text:string;failed:boolean}[]=[];
  for(const step of steps){const phrase=stepPhrase(step.label,pt);if(phrase.thinking)continue;const text=phrase.done;if(out.at(-1)?.text===text&&!out.at(-1)?.failed)continue;out.push({id:step.id,text,failed:step.status==='error'});}
  return out;
}

/** "14 s", "2 min 05 s", "1 h 02 min": how long the agent worked, read at a glance. */
export function formatRunDuration(milliseconds:number):string {
  const seconds=Math.floor(Math.max(0,Number.isFinite(milliseconds)?milliseconds:0)/1000);
  if(seconds<60)return `${seconds} s`;
  const minutes=Math.floor(seconds/60);
  if(minutes<60)return `${minutes} min ${String(seconds%60).padStart(2,'0')} s`;
  return `${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,'0')} min`;
}
