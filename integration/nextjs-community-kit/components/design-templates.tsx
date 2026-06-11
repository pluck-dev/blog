/**
 * 디자인 템플릿 5종 — 양산 관리자의 designTemplates.ts 와 1:1 대응.
 *
 * 콘텐츠(데이터)는 중앙 API에서 오고, "어떻게 보이는지"는 이 컴포넌트가 결정한다.
 * 테넌트(사이트)마다 이 파일만 갈아끼우면 같은 콘텐츠를 다른 디자인으로 렌더할 수 있다 = SaaS.
 *
 * 여기서는 인라인 style 로 최소 구현했지만, 실제 사이트에서는 Tailwind/CSS 모듈로 바꿔 쓰면 된다.
 */

import type { ReactNode } from "react";

export type DesignTemplateId =
  | "editorial" | "comparison" | "local-guide" | "checklist" | "conversion" | "custom";

interface DesignSpec {
  accent: string;
  pageBg: string;
  topCta: string;
  bottomCta: string;
}

const SPECS: Record<DesignTemplateId, DesignSpec> = {
  editorial:    { accent: "#5132d7", pageBg: "#fbfaf8", topCta: "지금 바로 비교·예약", bottomCta: "상담/예약하러 가기" },
  comparison:   { accent: "#2563eb", pageBg: "#f8fafc", topCta: "BEST 한눈에 비교", bottomCta: "내게 맞는 곳 찾기" },
  "local-guide":{ accent: "#059669", pageBg: "#f0fdf4", topCta: "내 주변에서 찾기", bottomCta: "가까운 곳 예약하기" },
  checklist:    { accent: "#ca8a04", pageBg: "#fefce8", topCta: "체크리스트 저장", bottomCta: "준비 시작하기" },
  conversion:   { accent: "#111827", pageBg: "#f5f3ff", topCta: "비용 상담 신청", bottomCta: "지금 예약하기" },
  custom:       { accent: "#5132d7", pageBg: "#fbfaf8", topCta: "자세히 보기", bottomCta: "문의하기" },
};

export function resolveDesign(id: string | null | undefined): DesignTemplateId {
  return (id && id in SPECS ? id : "editorial") as DesignTemplateId;
}

export interface DesignLayoutProps {
  designId: string | null | undefined;
  title: string;
  /** CTA 버튼이 가리킬 링크(예약/상담 페이지). */
  ctaHref?: string;
  /** 본문에서 사용할 브랜드명(CTA 문구에 노출). */
  brand?: string;
  children: ReactNode;
}

/**
 * 디자인 셸. 상단/하단 CTA + accent 색상을 입혀 본문을 감싼다.
 * PostRenderer 가 만든 본문을 children 으로 받는다.
 */
export function DesignLayout({ designId, title, ctaHref = "#", brand = "운전면허플러스", children }: DesignLayoutProps): ReactNode {
  const publicBrand = brand.replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || brand;
  const d = resolveDesign(designId);
  const spec = SPECS[d];
  return (
    <article className={`community-post design-${d}`} style={{ background: spec.pageBg, ["--accent" as string]: spec.accent }}>
      <header className="post-top-cta" style={{ background: spec.accent }}>
        <span>{publicBrand} · {spec.topCta}</span>
        <a href={ctaHref} className="cta-button">바로가기 →</a>
      </header>

      <div className="post-body">
        <h1 className="post-title">{title}</h1>
        {children}
      </div>

      <footer className="post-bottom-cta">
        <p>{publicBrand}에서 {spec.bottomCta}</p>
        <a href={ctaHref} className="cta-button cta-primary">{spec.bottomCta}</a>
      </footer>
    </article>
  );
}

export default DesignLayout;
