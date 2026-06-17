import React from "react";
import { Composition } from "remotion";
import { CardNewsShort } from "./CardNewsShort";
import { sampleManifest } from "./sample-manifest";
import type { CardNewsManifest } from "./types";

export function RemotionRoot() {
  return (
    <Composition
      id="CardNewsShort"
      component={CardNewsShort}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={240}
      defaultProps={sampleManifest}
      calculateMetadata={({ props }: { props: CardNewsManifest }) => ({
        durationInFrames: Math.max(150, (props.cards?.length || 1) * 138),
      })}
    />
  );
}
