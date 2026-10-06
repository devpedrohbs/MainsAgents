import type {CarouselDraft} from '../../features/content/model';
import './carousel-review.css';

/** Copy and briefs remain editable; this component never claims rendered assets. */
export function CarouselReview({value,onChange,pt,readOnly=false}:{value:CarouselDraft;onChange?:(value:CarouselDraft)=>void;pt:boolean;readOnly?:boolean}){
 const patch=(index:number,field:'title'|'text'|'imageBrief',text:string)=>onChange?.({...value,slides:value.slides.map((slide,i)=>i===index?{...slide,[field]:text}:slide)});
 const move=(index:number,offset:number)=>{const slides=value.slides.slice(),other=index+offset;[slides[index],slides[other]]=[slides[other],slides[index]];onChange?.({...value,slides:slides.map((slide,i)=>({...slide,order:i+1}))});};
 const fieldLabel=(field:'title'|'text'|'imageBrief')=>field==='title'?(pt?'Título':'Title'):field==='text'?(readOnly?(pt?'Texto':'Copy'):(pt?'Texto editável':'Editable copy')):(pt?'Briefing de imagem':'Image brief');
 return <section className="carousel-review" data-mode={readOnly?'read-only':'edit'} aria-label={pt?'Revisão do carrossel':'Carousel review'}>
  <h3>{readOnly?(pt?'Slides e legenda aprovados · somente leitura':'Approved slides and caption · read-only'):(pt?'Slides e briefings editáveis':'Editable slides and image briefs')}</h3>
  <p className="editorial-hint">{readOnly?(pt?'Versão aprovada, sem edição nesta tela. Imagens e exportação de layout ainda não foram geradas.':'Approved version, not editable here. Images and layout exports have not been generated.'):(pt?'Texto e direção visual para revisão. Imagens e exportação de layout ainda não foram geradas.':'Copy and visual direction for review. Images and layout exports have not been generated.')}</p>
  {value.slides.map((slide,index)=><fieldset className="editorial-review carousel-slide" key={index}><legend>{pt?'Slide':'Slide'} {slide.order}</legend>
   {(['title','text','imageBrief'] as const).map(field=><label className={`editorial-field${field==='title'?' carousel-title':''}`} key={field}><span>{fieldLabel(field)}</span><textarea aria-label={`${field} slide ${index+1}`} rows={field==='title'?1:4} value={slide[field]} readOnly={readOnly} onChange={event=>patch(index,field,event.target.value)}/></label>)}
   {slide.sourceUrls.length>0&&<p className="carousel-sources"><span>{pt?'Fontes:':'Sources:'}</span>{slide.sourceUrls.map(url=><a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>)}</p>}
   {!readOnly&&<div className="editorial-actions"><button type="button" className="soft-button" disabled={index===0} onClick={()=>move(index,-1)}>{pt?'Mover para cima':'Move up'}</button><button type="button" className="soft-button" disabled={index===value.slides.length-1} onClick={()=>move(index,1)}>{pt?'Mover para baixo':'Move down'}</button></div>}
  </fieldset>)}
  <label className="editorial-field carousel-caption"><span>{pt?'Legenda do post':'Post caption'}</span><textarea aria-label="Carousel caption" rows={4} value={value.caption} readOnly={readOnly} onChange={event=>onChange?.({...value,caption:event.target.value})}/></label>
 </section>;
}
