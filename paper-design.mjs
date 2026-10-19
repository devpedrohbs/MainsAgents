export const paperVisualStyle=`Base editorial inicial, ponto de partida e não paleta fixa: composição editorial com hierarquia forte, títulos grandes, muito respiro, fotos e screenshots reais, leitura confortável no celular, textos editáveis e slides coerentes entre si.
Cores flexíveis por peça: se o criador indicar paleta, cores, referência ou estilo, siga isso. Sem indicação, escolha uma paleta coesa adequada ao tema (um fundo dominante, texto com contraste alto e um destaque) e diga qual usou, sem perguntar paleta desnecessariamente. Exemplo opcional, não obrigatório: o azul editorial das primeiras referências (#41799F, #A8D7E8, #F7F8F4, #173029).
Formato inicial 1080 × 1350 px, adaptável ao pedido. Capa com foto real autorizada e uma palavra ou assunto dominante; sem foto adequada, capa tipográfica forte. Títulos em sans-serif pesada (confirme no Paper Inter, Manrope ou equivalente disponível), com 120–180 px; a palavra dominante pode chegar a 220 px. Um destaque em serifada itálica é opcional e depende do estilo da peça. Corpo 40–48 px, entrelinha confortável e margem segura de 72 px.
Uma ideia por slide; nos tutoriais, screenshots reais grandes em moldura que se destaque do fundo. Capture ou use arquivos reais fornecidos; não simule uma interface como prova. Não reduza screenshots inteiros até ficarem ilegíveis: destaque o trecho relevante. Cor do texto, tratamento sobre fotos, destaques e o CTA final (curto, em cápsula ou equivalente) seguem a paleta e o estilo da peça, sempre com contraste legível. Assinatura discreta e consistente, quando configurada.
Preserve os textos como camadas editáveis, separados de fotografias e screenshots. Adapte a composição a cada slide. Controles de navegação, bolinhas e ícones do Instagram vistos em referências não pertencem à arte. Confira cada slide em escala de celular antes de exportar.`;

const paperKeys=['enabled','automatic','fileId','fileName','signature','visualStyle'];
/** Paper file IDs as the CLI reports them; anything else is never put in a prompt or compared for authority. */
export const paperFileIdPattern=/^[A-Za-z0-9_:.-]{1,200}$/;
export function validPaperDesign(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>paperKeys.includes(key))&&typeof value.enabled==='boolean'&&typeof value.automatic==='boolean'&&['fileId','fileName','signature','visualStyle'].every(key=>typeof value[key]==='string')&&(value.fileId===''||paperFileIdPattern.test(value.fileId))&&value.fileName.length<=300&&value.signature.length<=120&&value.visualStyle.length<=12000;
}
/** Imported or restored configuration never carries the no-repeat grant: the person re-enables it in this app. */
export function withoutPaperAutomation(agent){
 return agent&&typeof agent==='object'&&!Array.isArray(agent)&&agent.paperDesign&&typeof agent.paperDesign==='object'&&agent.paperDesign.automatic!==false?{...agent,paperDesign:{...agent.paperDesign,automatic:false}}:agent;
}

export function paperDesignInstructions(agent){
 const value=agent?.paperDesign;if(!validPaperDesign(value)||!value.enabled||!value.fileId)return '';
 return `\n\nCurrent saved MainsAgents Paper carousel parameters (override older carousel skill defaults; the visual base is only a fallback for the user's own visual requests):
Use the Paper MCP server for requested carousel design. Target fileId ${JSON.stringify(value.fileId)} (${JSON.stringify(value.fileName.replace(/[\u0000-\u001f\u007f]/g,' '))}); do not create, open or edit a different file. Read get_guide(topic="paper-mcp-instructions") and get_basic_info(fileId=...) before creating; look up fonts before styling. Work on a new page for a new carousel, and keep its pageId and ordered artboard IDs for later edits. Use explicit fileId/pageId arguments so the active Desktop page cannot redirect the work. Resume an existing carousel when the user asks for an edit.
Saved visual base (fallback): ${value.visualStyle.trim()||paperVisualStyle}
Visual precedence: for a specific carousel, colors, palette, references or a style the user explicitly gives in the current request or earlier for that same carousel override the saved visual base; keep that piece coherent across its slides and later edits. Without such a request, use the saved base and choose a palette suited to the theme. Return to the saved base for a new unrelated carousel. Use a visual reference only after opening it (for example a readable local file path); if it cannot be opened, say what is missing and follow the text description, never claiming to have seen it. A one-off visual request never changes the saved parameters, agent instructions or skills; only an explicit request to save a new default does, made by the user in Configure → Paper. This override covers visual choices only: the target file, approvals, signature, paid generation and source honesty rules here still apply.
Signature: ${value.signature.trim()?JSON.stringify(value.signature.trim()):'Not configured: omit brand text instead of inventing a name or using the reference creator logo.'}
${value.automatic?'The user enabled routine carousel production in this selected file without repeated confirmations: reads, creating pages and artboards, writing and replacing layout (write_html insert-children or replace), text, style and design-token edits, duplicating, moving and renaming nodes, placing verified local images, and image/PDF export. Do not ask the user to approve these steps. The MainsAgents host verifies each call and the file scope; deleting nodes, opening or creating another file, video export, unverified local images and paper-gen:// generation still wait for the user\'s per-call approval, so correct a layout by replacing it rather than deleting it.':'MCP calls use the app approval controls. Ask only when an operation actually requires approval.'}
Keep layout text editable. For a request to make a carousel, create the design, inspect screenshots, fix visible issues, export ordered slides and finish_working_on_nodes; a text briefing alone is not the requested deliverable. Report only exports the tool confirmed. If it returns local files, use the app file-delivery JSON with real absolute paths; otherwise return the actual export links and identify the editable Paper document. Never invent a path. If Paper is unavailable, report the concrete connection issue and retain the content for resuming. Images: use provided assets or typography by default. When the user asks for generated images (for example GPT images), create them with the host image generation tool, then place the saved file in the layout with <img src="paper-asset:///C:/absolute/path.png"> (forward slashes); never paste data URIs. Generate only the images the user asked for. Credit-consuming paper-gen:// generation always needs a separate explicit request.`;
}

const globalReads=new Set(['get_guide','list_resources']);
const fileReads=new Set(['get_basic_info','get_selection','get_node_info','get_children','get_tree_summary','get_screenshot','get_jsx','get_computed_styles','get_fill_image','find_nodes','get_tokens','get_font_family_info','list_comment_threads','get_comment_thread','list_comment_thread_authors']);
// Routine corrections inside the selected file are part of the grant (write_html replace, set_tokens).
// delete_nodes, open_file, create_file, rename_resource and comment status stay per-call.
const fileWrites=new Set(['create_page','create_artboard','create_tokens','set_tokens','set_text_content','update_styles','duplicate_nodes','move_nodes','rename_nodes','rename_pages','write_html','finish_working_on_nodes','export','export_combined_pdf']);
const imageFormats=new Set(['png','jpg','webp','avif','pdf','svg']);
// Credit-consuming generation in any spelling (escaped, percent-encoded); a false match only means asking the person.
const codePoint=(code,radix)=>{const value=Number.parseInt(code,radix);return Number.isInteger(value)&&value>0&&value<=0x10ffff?String.fromCodePoint(value):' ';};
let assetVerifier=null;
/** Host hook (worker B: createVerifiedImageIndex().verify): path -> {ok:boolean}. Without it local images are reviewed per call. */
export function setPaperAssetVerifier(verify){assetVerifier=typeof verify==='function'?verify:null;}
/** Decoded absolute paths of every paper-asset:// reference in the arguments; an undecodable one never verifies. */
export function paperAssetReferences(args){
 const paths=[],strings=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
 let mentions=0;
 for(const raw of strings(args)){
  // Every spelling (CSS/JS/HTML/percent escapes) counts as a mention; paths are parsed from entity/\u-decoded text.
  mentions+=(decodeAll(raw).match(/paper[^a-z0-9]{0,12}asset/gi)??[]).length;
  const text=raw.replace(/&#(x?)([0-9a-f]+);?/gi,(_,x,code)=>codePoint(code,x?16:10)).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>codePoint(hex,16)).replace(/\\/g,'/');
  // Windows: paper-asset:///C:/x.png -> C:/x.png; POSIX keeps its leading slash: paper-asset:///home/x.png -> /home/x.png.
  for(const match of text.matchAll(/paper-asset:\/\/(\/[A-Za-z]:[^"'()\s<>]*|[A-Za-z]:[^"'()\s<>]*|\/[^"'()\s<>]+)/gi)){try{paths.push(decodeURIComponent(match[1].replace(/^\/(?=[A-Za-z]:)/,'')));}catch{paths.push('\u0000');}}
 }
 // A mention that did not parse into a path (hidden spelling) never verifies.
 if(paths.length<mentions)paths.push('\u0000');
 return paths;
}
const decodeAll=text=>String(text).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>codePoint(hex,16)).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>codePoint(hex,16)).replace(/%([0-9a-f]{2})/gi,(_,hex)=>codePoint(hex,16)).replace(/&#(x?)([0-9a-f]+);?/gi,(_,x,code)=>codePoint(code,x?16:10)).replace(/&colon;/gi,':').replace(/&sol;/gi,'/');
const generationReference=args=>/paper[^a-z0-9]{0,12}gen/i.test(JSON.stringify(args).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>codePoint(hex,16)).replace(/\u([0-9a-f]{4})/gi,(_,hex)=>codePoint(hex,16)).replace(/%([0-9a-f]{2})/gi,(_,hex)=>codePoint(hex,16)).replace(/&#(x?)([0-9a-f]+);?/gi,(_,x,code)=>codePoint(code,x?16:10)));
/**
 * Optional explicit per-agent grant: known design operations in one selected file; no global CLI grants.
 * Returns the reason for an automatic approval, or null so the call goes to the normal per-call review.
 */
export function paperAutomaticDecision(agent,server,tool,args){
 const value=agent?.paperDesign;
 if(server!=='paper'||!['claude','codex'].includes(agent?.providerId??'codex')||!validPaperDesign(value)||!value.enabled||!value.automatic||!value.fileId||!args||typeof args!=='object'||Array.isArray(args))return null;
 if(generationReference(args))return null;
 if(globalReads.has(tool))return 'Configured Paper connection reads';
 if(args.fileId!==value.fileId)return null;
 if(fileReads.has(tool))return 'Configured Paper reads in the selected file';
 if(tool==='write_html'&&!['insert-children','replace'].includes(args.mode))return null;
 // Local images: only files the host verified (its image store or exports it produced); anything else is reviewed per call.
 const assets=paperAssetReferences(args);if(assets.length&&(!assetVerifier||!assets.every(path=>assetVerifier(path)?.ok===true)))return null;
 if(tool==='export'&&(args.type!==undefined&&args.type!=='image'||!args.nodes||typeof args.nodes!=='object'||Array.isArray(args.nodes)||Object.values(args.nodes).some(items=>!Array.isArray(items)||!items.length||items.some(item=>!item||typeof item!=='object'||!imageFormats.has(item.format)||item.durationSeconds!==undefined))))return null;
 return fileWrites.has(tool)?'Configured Paper design and export in the selected file':null;
}
