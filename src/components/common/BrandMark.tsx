// MainsAgents mark v2 (Claude Design · Logo.dc.html): flat conductor on a 64-unit grid.
// `body` paints the silhouette and baton; `eye` paints the cut-outs (eyes and bow tie).
export function BrandMark({body='currentColor',eye='var(--surface)',className}:{body?:string;eye?:string;className?:string}) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M14 30 A18 18 0 0 1 50 30 V46 Q50 54 41 57 L32 49 L23 57 Q14 54 14 46 Z" fill={body}/>
    <ellipse cx="26" cy="29" rx="2.6" ry="3.6" fill={eye}/>
    <ellipse cx="38" cy="29" rx="2.6" ry="3.6" fill={eye}/>
    <path d="M28.5 39 L32 41 L28.5 43 Z M35.5 39 L32 41 L35.5 43 Z" fill={eye}/>
    <path d="M55 37 L61 24" fill="none" stroke={body} strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="54" cy="39" r="3.4" fill={body}/>
  </svg>;
}
