export function editorialReviewCommand(text:string):{decision:'approve'|'rejected'|'revision-requested';notes:string;target?:'files'}|null {
  const clean=text.trim();
  if(/^(aprovo|aprovar|approve|approved)( (esse|este|esses|estes|o|os|this|these|the))? (vídeo|video|arquivos|files|entrega)[.!]?$/i.test(clean))return {decision:'approve',notes:'',target:'files'};
  if(/^(rejeito|rejeitar|reject)( (esse|este|esses|estes|o|os|this|these|the))? (vídeo|video|arquivos|files|entrega)[.!]?$/i.test(clean))return {decision:'rejected',notes:'',target:'files'};
  const fileRevision=clean.match(/^(?:ajuste|revisar|revise) (?:vídeo|video|arquivos|files|entrega)\s*:\s*([\s\S]+)$/i);if(fileRevision)return {decision:'revision-requested',notes:fileRevision[1].trim(),target:'files'};
  if(/^(aprovo|aprovado|aprovar|approve|approved)( (esse|este|o|this|the))?( roteiro| script)?[.!]?$/i.test(clean))return {decision:'approve',notes:''};
  if(/^(rejeito|rejeitar|descartar|reject)( (esse|este|o|this|the))?( roteiro| script)?[.!]?$/i.test(clean))return {decision:'rejected',notes:''};
  const revision=clean.match(/^(?:ajuste|ajustar|revisar|revision|revise|request changes)\s*:\s*([\s\S]+)$/i);
  return revision?{decision:'revision-requested',notes:revision[1].trim()}:null;
}
