import { Fragment, type ReactNode } from 'react';

// Renders agent markdown as React elements (no innerHTML). Supports headings, lists,
// quotes, fenced code, **bold**, *italic*, `code`, [links](url) and bare URLs.
// Links are collected into a numbered "Fontes" row; local file links become file chips.

type Source = { href: string; label: string; local: boolean };

const isLocalPath = (href: string) => /^(?:[a-zA-Z]:[\\/]|\/|file:)/.test(href);
const domainOf = (href: string) => {
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return href; }
};
const fileName = (href: string) => href.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? href;

function inline(text: string, sources: Source[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'”’]|\*[^*\s][^*]*?\*)/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyBase}-${index++}`;
    if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={key}>{inline(token.slice(2, -2), sources, key)}</strong>);
    else if (token.startsWith('`')) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
      const local = isLocalPath(href);
      if (!sources.some(source => source.href === href)) sources.push({ href, label, local });
      out.push(local
        ? <span className="md-file" key={key} title={href}>{label}</span>
        : <a key={key} href={href} target="_blank" rel="noopener noreferrer" title={href}>{label}</a>);
    } else if (token.startsWith('http')) {
      if (!sources.some(source => source.href === token)) sources.push({ href: token, label: domainOf(token), local: false });
      out.push(<a key={key} href={token} target="_blank" rel="noopener noreferrer">{domainOf(token)}</a>);
    } else out.push(<em key={key}>{inline(token.slice(1, -1), sources, key)}</em>);
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const quoted = (text: string) => /^["“].+["”]$/s.test(text.trim());

export function MessageMarkdown({ text, className }: { text: string; className?: string }) {
  const sources: Source[] = [];
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const body = paragraph.join('\n');
    const k = `p${key++}`;
    blocks.push(quoted(body)
      ? <blockquote className="md-script" key={k}>{inline(body, sources, k)}</blockquote>
      : <p key={k}>{inline(body, sources, k)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${key++}`;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, sources, `${k}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flushParagraph(); flushList();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]);
      blocks.push(<pre key={`c${key++}`}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    if (!trimmed) { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(); flushList();
      const k = `h${key++}`;
      blocks.push(<h4 key={k} className={`md-h${heading[1].length}`}>{inline(heading[2], sources, k)}</h4>);
      continue;
    }
    // A line that is only bold text works as a section title in agent replies.
    const boldTitle = /^\*\*([^*]+)\*\*:?$/.exec(trimmed);
    if (boldTitle) {
      flushParagraph(); flushList();
      const k = `t${key++}`;
      blocks.push(<h4 key={k} className="md-title">{inline(boldTitle[1], sources, k)}</h4>);
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushParagraph(); flushList();
      const k = `q${key++}`;
      blocks.push(<blockquote className="md-script" key={k}>{inline(trimmed.replace(/^>\s?/, ''), sources, k)}</blockquote>);
      continue;
    }
    if (list) { flushList(); }
    paragraph.push(line);
  }
  flushParagraph(); flushList();
  const web = sources.filter(source => !source.local);
  const files = sources.filter(source => source.local);
  return <div className={`message-markdown ${className ?? ''}`.trim()}>
    {blocks.map((block, i) => <Fragment key={i}>{block}</Fragment>)}
    {(web.length > 0 || files.length > 0) && <div className="md-sources">
      <span className="md-sources-label">{document.documentElement.lang==='en'?'Sources':'Fontes'}</span>
      <div>
        {web.map((source, i) => <a key={source.href} href={source.href} target="_blank" rel="noopener noreferrer" title={source.href}>
          <span className="md-source-n">{i + 1}</span><span className="md-source-title">{source.label}</span><span className="md-source-domain">{domainOf(source.href)}</span>
        </a>)}
        {files.map(source => <span key={source.href} className="md-source-file" title={source.href}>{fileName(source.href)}</span>)}
      </div>
    </div>}
  </div>;
}
