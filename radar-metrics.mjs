/**
 * Radar metrics: pure, deterministic. A video is compared with the median of its own channel's mature videos as collected
 * together (same moment), never with other channels or platforms. Missing numbers stay null; nothing is interpolated.
 */
export const RADAR_THRESHOLDS=Object.freeze({minBaseline:10,matureDays:7,highlightRatio:3,shortMaxSeconds:180,minGrowthHours:1});
const DAY=86_400_000;

export function median(values){
 const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;
 const mid=sorted.length>>1;return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
/** 'short' by duration is an inference (YouTube does not flag Shorts in the API), and is labelled as such. */
export const videoFormat=video=>video.live?'live':Number.isFinite(video.durationSeconds)?(video.durationSeconds<=RADAR_THRESHOLDS.shortMaxSeconds?'short':'video'):'unknown';
export const isMature=(publishedAt,at)=>{const p=Date.parse(publishedAt??''),t=Date.parse(at??'');return Number.isFinite(p)&&Number.isFinite(t)&&t-p>=RADAR_THRESHOLDS.matureDays*DAY;};

/**
 * @param item      {externalId, publishedAt, durationSeconds, live}
 * @param snapshots this item's rows, any order: {id, collectedAt, views, likes, comments, source}
 * @param baseline  latest channel sample {collectedAt, videos:[{videoId, views, publishedAt, durationSeconds, live}]} or null
 */
export function videoMetrics(item,snapshots,baseline){
 const rows=[...snapshots].sort((a,b)=>Date.parse(a.collectedAt)-Date.parse(b.collectedAt)),latest=rows.at(-1)??null;
 const format=videoFormat(item),at=latest?.collectedAt??null,maturity=isMature(item.publishedAt,at)?'mature':'immature';
 const limitations=[];
 if(latest?.source==='youtube-rss')limitations.push('Coletado pelo RSS do canal: só visualizações; curtidas, comentários e duração indisponíveis, e a base usa no máximo os 15 vídeos mais recentes.');
 if(format==='short')limitations.push('"Short" é inferido pela duração (≤ 3 min); a API não marca Shorts.');
 if(maturity==='immature')limitations.push('Vídeo com menos de 7 dias: a comparação com vídeos maduros tende a subestimar o resultado final.');
 limitations.push('Números públicos não mostram retenção, CTR, origem do tráfego nem impulsionamento pago; não provam a causa do desempenho.');

 let pool=(baseline?.videos??[]).filter(v=>v.videoId!==item.externalId&&!v.live&&Number.isFinite(v.views)&&isMature(v.publishedAt,baseline.collectedAt));
 if(format==='short'||format==='video'){
  const same=pool.filter(v=>videoFormat(v)===format);
  if(same.length>=RADAR_THRESHOLDS.minBaseline)pool=same;
  else if(pool.some(v=>Number.isFinite(v.durationSeconds)))limitations.push('A base mistura Shorts e vídeos longos (poucos vídeos do mesmo formato).');
 }
 const baselineCount=pool.length,mid=median(pool.map(v=>v.views));
 let baselineStatus=format==='live'?'not_applicable':baselineCount>=RADAR_THRESHOLDS.minBaseline&&mid>0?'ok':'insufficient';
 if(!baseline)limitations.push('Canal sem base coletada (descoberta por busca sem amostra do canal).');
 else if(baselineStatus==='insufficient')limitations.push(`Base insuficiente: ${baselineCount} vídeo(s) maduro(s) do canal; são necessários ${RADAR_THRESHOLDS.minBaseline}.`);
 if(format==='live')limitations.push('Transmissões ao vivo não são comparadas com a base do canal.');
 const views=latest?.views??null,ok=baselineStatus==='ok'&&Number.isFinite(views);
 const ratio=ok?views/mid:null,logScore=ok?Math.log10(views+1)-Math.log10(mid+1):null;

 let growth=null;
 const counted=rows.filter(r=>Number.isFinite(r.views));
 if(counted.length>=2){
  const from=counted.at(-2),to=counted.at(-1),hours=(Date.parse(to.collectedAt)-Date.parse(from.collectedAt))/3_600_000;
  if(hours>=RADAR_THRESHOLDS.minGrowthHours)growth={viewsPerHour:(to.views-from.views)/hours,fromSnapshotId:from.id,toSnapshotId:to.id,hours};
 }
 if(!growth)limitations.push('Crescimento indisponível: são necessárias duas coletas com pelo menos 1 h de intervalo.');
 return {latest,baselineCount,baselineMedian:baselineStatus==='ok'?mid:null,baselineStatus,ratio,logScore,maturity,format,growth,limitations};
}
export const isVideoHighlight=metrics=>metrics?.baselineStatus==='ok'&&Number.isFinite(metrics.ratio)&&metrics.ratio>=RADAR_THRESHOLDS.highlightRatio;
