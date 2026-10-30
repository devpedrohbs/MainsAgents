import { useLanguage } from '../../app/LanguageProvider';

export type RunState = 'queued'|'running'|'waiting'|'paused'|'done'|'failed';

const labels:Record<RunState,[string,string]>={queued:['Na fila','Queued'],running:['Executando','Running'],waiting:['Aguardando você','Waiting for you'],paused:['Pausado','Paused'],done:['Concluído','Done'],failed:['Falhou','Failed']};

/** V2 run-state glyph: each state has its own shape, colored by the --state-* tokens. */
export function StatusIcon({state,size=14,label}:{state:RunState;size?:number;label?:string}) {
  const {locale}=useLanguage();
  const text=label??labels[state][locale==='pt-BR'?0:1],c=`var(--state-${state})`,ink='var(--frame)';
  return <span className="v2-status" role="img" aria-label={text} title={text} style={{width:size,height:size}}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {state==='queued'&&<circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2.4 2.1"/>}
      {state==='running'&&<><circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.5"/><path d="M8 4.6A3.4 3.4 0 0 1 8 11.4Z" fill={c}/></>}
      {state==='waiting'&&<><circle cx="8" cy="8" r="6.75" fill={c}/><path d="M8 4.7v4" stroke={ink} strokeWidth="1.7" strokeLinecap="round"/><circle cx="8" cy="11.1" r="1" fill={ink}/></>}
      {state==='paused'&&<><circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.5"/><path d="M6.6 5.8v4.4M9.4 5.8v4.4" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></>}
      {state==='done'&&<><circle cx="8" cy="8" r="6.75" fill={c}/><path d="M5.2 8.2l1.9 1.9 3.7-3.9" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>}
      {state==='failed'&&<><circle cx="8" cy="8" r="6.75" fill={c}/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke={ink} strokeWidth="1.6" strokeLinecap="round"/></>}
    </svg>
  </span>;
}
