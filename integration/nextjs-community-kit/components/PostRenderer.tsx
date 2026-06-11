/**
 * 양산 콘텐츠 마크다운 → React 렌더러.
 *
 * 표준 마크다운 + 우리 커스텀 슬롯을 처리한다:
 *   - 헤딩/문단/리스트/blockquote
 *   - 실제 마크다운 표(|...|)
 *   - [IMAGE:key] / [IMAGE_SLOT: kind] → 이미지 자리(타깃 사이트가 실제 이미지로 교체 가능)
 *   - [TABLE_SLOT: name]      → 안내 표(LLM이 실제 표를 마크다운으로 넣으므로 보조용)
 *   - [INTERNAL_LINK: label]  → 내부 링크
 *   - 출처 번호 [1]           → 위첨자
 *   - '## 참고자료' 섹션의 맨 URL → 링크 자동화
 *
 * 외부 의존성 없음(react만). 타깃 사이트의 CSS/디자인에 맞게 className 을 바꿔 쓰면 된다.
 */

import { Fragment, type ReactNode } from "react";

export interface PostRendererProps {
  markdown: string;
  /** 이미지 슬롯 kind → 실제 이미지 URL 매핑(있으면 이미지로 렌더). */
  images?: Record<string, string>;
  /** 내부 링크 label → 경로 매핑(있으면 해당 경로로). */
  internalLinks?: Record<string, string>;
}

/** 인라인 마크다운(굵게/기울임/코드/링크/맨URL/출처번호)을 React 노드로. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  // 토큰 단위로 분해: **bold**, *italic*, `code`, [txt](url), 맨 URL, [1]
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<)]+|\[\d+\])/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("*")) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[") && tok.includes("](")) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok)!;
      out.push(<a key={key} href={mm[2]} rel="nofollow noopener" target="_blank">{mm[1]}</a>);
    } else if (/^\[\d+\]$/.test(tok)) {
      out.push(<sup key={key} className="cite">{tok}</sup>);
    } else {
      // 맨 URL
      out.push(<a key={key} href={tok} rel="nofollow noopener" target="_blank">{tok}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderTable(rows: string[], key: string): ReactNode {
  const cells = (row: string) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const isSep = (row: string) => /^\|?[\s:|-]+\|?$/.test(row) && row.includes("-");
  let header: string[] | null = null;
  const body: string[][] = [];
  for (const row of rows) {
    if (isSep(row)) continue;
    const c = cells(row);
    if (!header) header = c;
    else body.push(c);
  }
  if (!header) return null;
  return (
    <div className="md-table" key={key}>
      <table>
        <thead><tr>{header.map((c, i) => <th key={i}>{renderInline(c, `${key}-th-${i}`)}</th>)}</tr></thead>
        {body.length > 0 && (
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c, `${key}-td-${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

export function PostRenderer({ markdown, images = {}, internalLinks = {} }: PostRendererProps): ReactNode {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let table: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={`p-${k++}`}>{renderInline(para.join(" "), `p-${k}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it, `li-${k}-${i}`)}</li>);
    blocks.push(list.type === "ul" ? <ul key={`l-${k++}`}>{items}</ul> : <ol key={`l-${k++}`}>{items}</ol>);
    list = null;
  };
  const flushTable = () => {
    if (!table.length) return;
    const t = renderTable(table, `t-${k++}`);
    if (t) blocks.push(t);
    table = [];
  };
  const flushAll = () => { flushTable(); flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line)) { flushPara(); flushList(); table.push(line); continue; }
    if (table.length) flushTable();
    if (!line) { flushAll(); continue; }

    const image = /^\[IMAGE(?::|_SLOT:)\s*([^\]]+)\]$/.exec(line);
    const tableSlot = /^\[TABLE_SLOT:\s*([^\]]+)\]$/.exec(line);
    const internal = /^\[INTERNAL_LINK:\s*([^\]]+)\]$/.exec(line);
    if (image) {
      flushAll();
      const kind = image[1].trim();
      const url = images[kind];
      blocks.push(
        url
          ? <figure className="post-image" key={`img-${k++}`}><img src={url} alt={kind} loading="lazy" /></figure>
          : <div className="image-slot" data-kind={kind} key={`img-${k++}`}><span>이미지 영역: {kind}</span></div>,
      );
      continue;
    }
    if (tableSlot) {
      flushAll();
      blocks.push(<div className="table-slot" data-name={tableSlot[1].trim()} key={`ts-${k++}`} />);
      continue;
    }
    if (internal) {
      flushAll();
      const label = internal[1].trim();
      const href = internalLinks[label] ?? "#";
      blocks.push(<p className="internal-link" key={`il-${k++}`}><a href={href}>{label}</a></p>);
      continue;
    }
    if (line.startsWith("# ")) { flushAll(); continue; } // H1은 제목으로 별도 표시(상세 페이지에서)
    if (line.startsWith("## ")) {
      flushAll();
      const title = line.slice(3);
      const isRef = /^참고\s*자료/.test(title);
      blocks.push(<h2 className={isRef ? "references-title" : undefined} key={`h2-${k++}`}>{title}</h2>);
      continue;
    }
    if (line.startsWith("### ")) { flushAll(); blocks.push(<h3 key={`h3-${k++}`}>{line.slice(4)}</h3>); continue; }
    if (line.startsWith(">")) {
      flushAll();
      blocks.push(<blockquote key={`bq-${k++}`}>{renderInline(line.replace(/^>\s*/, ""), `bq-${k}`)}</blockquote>);
      continue;
    }
    const bullet = /^(?:[-*]\s+|[✅✔✓]\s*)(.+)$/.exec(line);
    if (bullet) {
      flushPara(); flushTable();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      flushPara(); flushTable();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(ordered[1]);
      continue;
    }
    para.push(line);
  }
  flushAll();

  return <Fragment>{blocks}</Fragment>;
}

export default PostRenderer;
