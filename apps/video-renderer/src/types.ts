export type SocialCard = {
  index: number;
  role: "hook" | "point" | "cta" | string;
  title: string;
  body: string;
  accent?: string;
};

export type CardNewsManifest = {
  package_id?: string;
  tenant?: string;
  post_id?: string;
  post_slug?: string;
  platform?: string;
  style_id?: string;
  title: string;
  hook?: string | null;
  brand?: string;
  brand_color?: string;
  site_url?: string;
  post_url?: string;
  script?: string | null;
  caption?: string | null;
  hashtags?: string[];
  cards: SocialCard[];
  fps?: number;
  duration_sec?: number;
  output?: {
    filename?: string;
    directory?: string;
  };
};
