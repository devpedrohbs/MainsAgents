import type {ProviderWaitView} from './model';

/** Open wait of a provider for the whole profile (host /api/content/provider-waits). No content data. */
export interface ProviderGateView {providerId:string;label:string;kind:'quota'|'rate-limit';since:string;resetsAt:string|null;generation:number}

const time=(iso:string,locale:string)=>new Date(iso).toLocaleString(locale,{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
/**
 * What the person sees about a usage-limit wait: facts from the host only. The reset time is shown ONLY when the provider
 * sent it; otherwise it says it is unknown (never a countdown or an invented time).
 */
export function providerWaitText(wait:Pick<ProviderWaitView,'label'|'kind'|'since'|'resetsAt'>,pt:boolean,locale=pt?'pt-BR':'en-US'){
 const title=pt?`Aguardando limite de uso do ${wait.label}`:`Waiting for the ${wait.label} usage limit`;
 const since=pt?`Desde ${time(wait.since,locale)}`:`Since ${time(wait.since,locale)}`;
 const reset=wait.resetsAt?(pt?`Liberação informada pelo provedor: ${time(wait.resetsAt,locale)}`:`Reset reported by the provider: ${time(wait.resetsAt,locale)}`):(pt?'Horário de liberação desconhecido (o provedor não informou)':'Reset time unknown (not reported by the provider)');
 const how=pt?'Nada é reenviado sozinho. Use Retomar quando quiser tentar de novo: continua do que está guardado, sem refazer.':'Nothing is resent on its own. Use Resume when you want to try again: it continues from what is kept, without redoing it.';
 return {title,since,reset,how};
}

/** One-line notice for a chat whose provider is waiting (manual messages stay possible: the person's explicit choice). */
export function providerGateNotice(gate:ProviderGateView,pt:boolean,locale=pt?'pt-BR':'en-US'){
 const text=providerWaitText(gate,pt,locale);
 return pt?`${gate.label} está com limite de uso desde ${time(gate.since,locale)}. ${text.reset}. Mensagens enviadas agora podem ser recusadas; edições automáticas ficam guardadas até você usar Retomar.`:`${gate.label} hit a usage limit at ${time(gate.since,locale)}. ${text.reset}. Messages sent now may be refused; automatic edits stay saved until you use Resume.`;
}
