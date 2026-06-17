import type { CardNewsManifest } from "./types";

export const sampleManifest: CardNewsManifest = {
  title: "건강검진 전날, 이것만 확인하세요",
  hook: "검사 결과가 흔들리지 않게 전날 체크할 것만 빠르게 정리합니다.",
  brand: "체크픽",
  brand_color: "#5132d7",
  site_url: "https://checkpick.kr",
  post_url: "https://checkpick.kr/community/sample",
  platform: "youtube_shorts",
  style_id: "card-news-clean",
  cards: [
    { index: 1, role: "hook", title: "건강검진 전날", body: "이것만 확인하면 검사 당일 덜 헤맵니다." },
    { index: 2, role: "point", title: "금식 시간", body: "검사 종류별 금식 안내를 먼저 확인하세요." },
    { index: 3, role: "point", title: "복용 약", body: "혈압약, 당뇨약은 병원 안내 기준을 따르세요." },
    { index: 4, role: "cta", title: "체크픽에서 이어보기", body: "https://checkpick.kr/community/sample" }
  ],
};
