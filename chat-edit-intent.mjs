/**
 * Deterministic classification of a chat message as an edit request (browser-safe, no imports). Shared by the renderer
 * (to route the send) and the host (which decides again on the SAVED message; the renderer never authorizes anything).
 */
export const CHAT_EDIT_CLASSIFIER_VERSION=1;
export const chatVideoPattern=/\.(mp4|mov|m4v|mkv|webm|avi)$/i;
const norm=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

// ------------------------------------------------------------------ classification (pure)

const TIME='(\\d{1,2}:\\d{2}(?:[.,]\\d+)?|\\d{1,4}(?:[.,]\\d+)?)';
const UNIT='(?:\\s*(?:s|seg|segs|segundos?|sec|secs|seconds?)\\b)?';
const timeValue=raw=>{const text=raw.replace(',','.');if(text.includes(':')){const [m,s]=text.split(':');return Number(m)*60+Number(s);}return Number(text);};
/** "entre 12 e 18 segundos", "de 0:12 a 0:18", "between 12s and 18s", "12s-18s", "12–18 s". Seconds of the EDITED video. */
export function parseTimeWindow(text){
 const s=norm(text);
 const patterns=[new RegExp(`(?:entre|de|do|from|between)\\s+(?:o\\s+|os\\s+)?(?:segundos?\\s+)?${TIME}${UNIT}\\s*(?:e|a|ao|ate|to|and|-|–|—)\\s*(?:o\\s+|os\\s+)?${TIME}${UNIT}`),new RegExp(`\\b${TIME}\\s*(?:s|seg)?\\s*[-–—]\\s*${TIME}\\s*(?:s|seg|segundos?|sec|seconds?)\\b`)];
 for(const pattern of patterns){const match=s.match(pattern);if(!match)continue;const start=timeValue(match[1]),end=timeValue(match[2]);if(Number.isFinite(start)&&Number.isFinite(end))return {start,end};}
 return null;
}
/** Quoted text (a cited command, an example) never counts as the person's request. */
const unquoted=text=>String(text??'').replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,' ').split(/\r?\n/).filter(line=>!/^\s*>/.test(line)).join('\n').replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|`[^`\n]*`|'[^'\n]{12,}'/g,' ');
const QUESTION_START=/^(?:e\s+)?(?:como|qual|quais|o que|oque|por que|porque|pq|quando|onde|quanto|sera|seria|voce acha|vc acha|vale a pena|da pra|da para|tem como|e possivel|how|what|why|which|when|where|should|would|is it|do you|does|is there)\b/;
const POLITE_ASK=/\b(?:pode|poderia|podia|consegue|conseguiria|voce pode|vc pode|can you|could you|would you|will you)\b/;
const POLITE_REQUEST=/^(?:(?:por favor|please)[,\s]+)?(?:(?:voce|vc)\s+)?(?:pode|poderia|podia|consegue|conseguiria|can you|could you|would you|will you)\s+(?:por favor\s+)?(?:editar|edite|edit|cortar|cut|trim|remover|remove|trocar|mudar|alterar|ajustar|replace|change|add)\b/;
const NEGATION=/\b(?:nao|nem|sem|nunca|never|dont|don't|do not|not|no need)\s+(?:\w+\s+){0,3}?(?:edit\w*|cort\w*|mex\w*|mud\w*|troc\w*|alter\w*|remov\w*|tir\w*|cut|trim|change|touch)\b/;
const ANALYSIS=/\b(?:analis\w*|avali\w*|opiniao|o que (?:voce |vc )?acha|feedback|sugest\w*|sugir\w*|sugere|critic\w*|comente|comenta|review|analy[sz]e|assess|thoughts|what do you think|explain|explique|explica)\b/;
const EDIT_IMPERATIVE=[
 /(?:^|[.!;,\n]\s*|\b(?:por favor|pfv|pf|agora|entao|ok|beleza|blz|please|now|so|then)\s+)(?:edite|edita|edit)\b/,
 /^(?:por favor\s+|please\s+)?editar\s+(?:o |a |este |esse |esta |essa |meu |minha |this |the )?(?:video|gravacao|clipe|recording|clip)\b/,
 /\b(?:faca|faz|fazer|monte|monta|make|do)\s+(?:a |uma |the |an )?(?:edicao|edit)\b/,
 /\b(?:quero|preciso|gostaria)\s+(?:que (?:voce |vc )?)?(?:edite|editar|edita|uma edicao|a edicao)\b/,
 /\b(?:i want|i need|i'd like)\s+(?:you to\s+)?(?:edit|an edit)\b/,
 /\b(?:corte|corta|cortar|tire|tira|remova|remove|limpe|limpa|cut|trim|clean up|remove)\s+(?:os |as |the |all )?(?:erros|retomadas|repeticoes|gaguejadas|gaguejos|falsos comecos|pausas|silencios|partes repetidas|mistakes|retakes|repetitions|false starts|stumbles|silences)\b/,
 /\b(?:edite|edita|edit|finalize|finaliza|monte|monta)\s+(?:o |a |este |esse |esta |essa |meu |minha |this |the |my )?(?:video|gravacao|clipe|recording|clip)\b/,
];
const VISUAL_VERB=/\b(?:troqu\w*|troca\w*|substitu\w*|mud\w*|alter\w*|coloqu\w*|coloca\w*|adicion\w*|inclu\w*|tire|tira|remov\w*|deix\w*|aument\w*|diminu\w*|ajust\w*|faca|faz|use|usa|replace|change|swap|add|remove|make|put|use)\b/;
/**
 * {kind:'edit'|'adjust'|'ambiguous'|'none', reason, window?}. 'edit' = the whole video (cuts + motion), 'adjust' = a visual
 * change in a window of the delivered EDITED video, 'ambiguous' = an edit is mentioned without an unequivocal request (the
 * chat answers normally and offers the explicit action). Deterministic; never consults a model.
 */
export function classifyEditRequest(text){
 const raw=String(text??'');
 if(!raw.trim()||raw.length>4000)return {kind:'none',reason:'empty'};
 const s=norm(unquoted(raw)).replace(/\s+/g,' ').trim();
 if(!s)return {kind:'none',reason:'quoted'};
 if(NEGATION.test(s))return {kind:'none',reason:'negated'};
 const question=s.includes('?'),window=parseTimeWindow(s),polite=POLITE_REQUEST.test(s),imperative=EDIT_IMPERATIVE.some(pattern=>pattern.test(s))||polite;
 // A how-to/analysis question can contain an imperative as an example. It never delegates work.
 if(QUESTION_START.test(s)&&!polite||ANALYSIS.test(s)&&!imperative)return {kind:'none',reason:question?'question':'analysis'};
 if(window&&VISUAL_VERB.test(s)){
  if(question&&!polite)return {kind:'ambiguous',reason:'question',window};
  if(!(window.end>window.start))return {kind:'none',reason:'invalid-window',window};
  return {kind:'adjust',reason:'window',window};
 }
 if(question&&QUESTION_START.test(s))return {kind:'none',reason:'question'};
 if(!imperative&&ANALYSIS.test(s))return {kind:'none',reason:'analysis'};
 if(imperative&&question&&!polite)return {kind:'ambiguous',reason:'question'};
 if(imperative)return {kind:'edit',reason:'imperative'};
 if(/\b(?:edit\w*|edicao|cort\w*|cut|trim)\b/.test(s)&&/\b(?:video|gravacao|clipe|recording|clip)\b/.test(s))return {kind:'ambiguous',reason:POLITE_ASK.test(s)?'polite':'mention'};
 return {kind:'none',reason:'no-request'};
}
/** Absolute local video paths typed in a message (quoted or bare). Paths only: the files are never read as text. */
export function videoPathsIn(text){
 const found=[],value=String(text??'');
 const quoted=/["“']((?:[a-z]:[\\/]|\/)[^"”'\r\n]{1,1000}?\.(?:mp4|mov|m4v|mkv|webm|avi))["”']/gi,bare=/(?:^|[\s(])((?:[a-z]:[\\/]|\/(?:Users|home|Volumes|mnt|tmp)\/)[^\s"'<>|*?\r\n]{1,1000}?\.(?:mp4|mov|m4v|mkv|webm|avi))(?=$|[\s"',;)])/gim;
 for(const match of value.matchAll(quoted))found.push(match[1]);
 for(const match of value.matchAll(bare))if(!found.includes(match[1]))found.push(match[1]);
 return [...new Set(found)].slice(0,20);
}

/** The same request with its time window replaced (explicit choice of a supported interval by the person). */
export function withTimeWindow(text,window){
 const fmt=value=>String(value).replace('.',',');
 const phrase=`Entre ${fmt(window.start)} e ${fmt(window.end)} segundos`;
 const cleaned=String(text??'').replace(new RegExp(`(?:entre|de|do|from|between)\\s+(?:o\\s+|os\\s+)?(?:segundos?\\s+)?${TIME}${UNIT}\\s*(?:e|a|ao|até|ate|to|and|-|–|—)\\s*(?:o\\s+|os\\s+)?${TIME}${UNIT}[,:]?\\s*`,'i'),'').replace(new RegExp(`\\b${TIME}\\s*(?:s|seg)?\\s*[-–—]\\s*${TIME}\\s*(?:s|seg|segundos?|sec|seconds?)\\b[,:]?\\s*`,'i'),'').trim();
 return `${phrase}: ${cleaned}`.slice(0,2000);
}
