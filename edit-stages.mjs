/** Host-enforced, versioned editing stages. Absent on older productions: their existing workflow is preserved. */
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const initialEditWorkflow=()=>({version:1,phase:'cuts'});
export const editPhase=p=>p?.editWorkflow?.version===1?p.editWorkflow.phase:null;

/** Both before and after media validation: no model/prompt can override the selected stage. */
export function editStageProblems(phase,plan,basePlan){
 const errors=[];
 if(phase==='cuts'){
  if(plan?.storyboard||plan?.animations?.length||(plan?.motion?.cues?.length||plan?.motion?.reframe))errors.push('Etapa 1: entregue apenas os cortes e o áudio, sem storyboard, motion, zoom, textos ou legendas. O acabamento começa depois da revisão do criador.');
 }
 if(phase==='visual'){
  if(!basePlan)return ['O corte base aprovado não está disponível.'];
  const visual=new Set(['storyboard','animations','motion','theme']);
  for(const key of new Set([...Object.keys(basePlan),...Object.keys(plan??{})])){
   if(!visual.has(key)&&!same(basePlan[key],plan?.[key]))errors.push(`Etapa 2: ${key} está congelado pelo corte base aprovado. Preserve cortes, ordem, formato e tratamento da voz.`);
  }
  // The media executor copies the approved audio packets. Do not accept effects it would then discard.
  if(plan?.storyboard?.sfx?.length)errors.push('Esta etapa preserva o áudio do corte base; não adicione efeitos sonoros ao storyboard.');
 }
 return errors;
}

export function editStageGuide(phase){
 if(phase==='cuts')return `ETAPA 1 — CORTE BASE. Esta restrição prevalece sobre pedidos de acabamento no briefing e nas skills. Selecione a fala e remova erros/retomadas/pausas excessivas com evidências e folga nas palavras; preserve respiração, ênfase e sentido. Use hard cuts como padrão; jump cuts deliberados para encurtar a fala. Não escreva storyboard, motion, zoom, títulos, efeitos visuais nem legendas. Entregue o corte para revisão e encerre: não comece o visual sozinho.`;
 if(phase==='visual')return `ETAPA 2 — ACABAMENTO VISUAL. O criador escolheu o corte base. Preserve EXATAMENTE segments, ordem, formato, duração e parâmetros da voz em currentPlan; não analise silêncios nem proponha novos cortes de fala. Crie storyboard/motion sobre a linha do tempo EDITADA. Use cutaways com assets reais para explicar a fala; match cuts só com correspondência visual comprovada. J/L-cuts independentes de áudio/imagem não estão disponíveis neste motor: não desloque a voz nem simule suporte. Não grave legendas da fala; reserve a faixa inferior para o SRT do CapCut. O app conserva os pacotes de áudio do corte aprovado, sem SFX novos nesta etapa.`;
 return '';
}
