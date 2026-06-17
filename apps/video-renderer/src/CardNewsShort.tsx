import React from "react";
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CardNewsManifest, SocialCard } from "./types";

const SAFE_MARGIN = 86;

export function CardNewsShort(props: CardNewsManifest) {
  const { fps } = useVideoConfig();
  const cards = props.cards.length ? props.cards : [{ index: 1, role: "hook", title: props.title, body: props.hook || "" }];
  const framesPerCard = Math.max(90, Math.round(fps * 4.6));
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f172a", color: "#111827", fontFamily: "Inter, Pretendard, system-ui, sans-serif" }}>
      {cards.map((card, index) => (
        <Sequence key={`${card.index}-${index}`} from={index * framesPerCard} durationInFrames={framesPerCard}>
          <CardFrame card={card} manifest={props} page={index + 1} total={cards.length} framesPerCard={framesPerCard} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function CardFrame({ card, manifest, page, total, framesPerCard }: { card: SocialCard; manifest: CardNewsManifest; page: number; total: number; framesPerCard: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 16, stiffness: 110 } });
  const opacity = interpolate(frame, [0, 12, framesPerCard - 18, framesPerCard], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(scale, [0, 1], [46, 0]);
  const brandColor = manifest.brand_color || "#5132d7";
  const isDark = card.role === "hook" || card.role === "cta";
  const bg = isDark
    ? `linear-gradient(155deg, ${brandColor}, #111827 70%)`
    : "linear-gradient(155deg, #ffffff, #f7f5ff 56%, #fffacc)";
  return (
    <AbsoluteFill style={{ padding: SAFE_MARGIN, background: bg, opacity }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: isDark ? "white" : "#111827", fontSize: 34, fontWeight: 900 }}>
        <span>{manifest.brand || manifest.tenant || "CheckPick"}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.72 }}>{page}/{total}</span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", transform: `translateY(${y}px)` }}>
        <div style={{ color: isDark ? "#ffe94d" : brandColor, fontSize: 42, fontWeight: 950, marginBottom: 34 }}>
          {card.role === "cta" ? "SAVE & READ" : card.role === "hook" ? "TODAY CHECK" : `CHECK ${page}`}
        </div>
        <div style={{ color: isDark ? "white" : "#0f172a", fontSize: fitTitle(card.title), lineHeight: 1.12, letterSpacing: "-0.04em", fontWeight: 950, whiteSpace: "pre-wrap" }}>
          {card.title}
        </div>
        <div style={{ color: isDark ? "#e0e7ff" : "#475569", fontSize: 46, lineHeight: 1.42, fontWeight: 800, marginTop: 48, whiteSpace: "pre-wrap" }}>
          {card.body}
        </div>
      </div>

      <div>
        <div style={{ height: 12, borderRadius: 999, background: isDark ? "rgba(255,255,255,.22)" : "#e2e8f0", overflow: "hidden" }}>
          <div style={{ width: `${(page / total) * 100}%`, height: "100%", background: isDark ? "#ffe94d" : brandColor }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, color: isDark ? "#cbd5e1" : "#64748b", fontSize: 28, fontWeight: 800 }}>
          <span>{manifest.platform || "shorts"}</span>
          <span>{manifest.post_url || manifest.site_url || ""}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function fitTitle(title: string): number {
  if (title.length > 30) return 74;
  if (title.length > 22) return 86;
  return 98;
}
