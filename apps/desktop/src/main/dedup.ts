/**
 * 양산 콘텐츠 중복 검출 — 의존성 없는 MinHash + LSH 구현.
 *
 * 파이프라인: normalize → shingle(k) → MinHash 시그니처 → LSH 밴딩으로 후보쌍 추출
 *           → 후보쌍만 정확 Jaccard 검증 → Union-Find 클러스터링.
 *
 * 경쟁사(운전선생) 분석에서 쓴 datasketch MinHashLSH(scripts/dedup_cluster_v2.py)를
 * 데스크탑 앱에서 외부 의존성 없이 돌리도록 TS로 이식. 테넌트당 글 수가 적어(수백~수천)
 * 후보쌍 정확 검증까지 부담 없음.
 */

export interface DedupInputPost {
  id: string;
  body_markdown: string;
  priority_score?: number | null;
  generated_at?: string | null;
}

export interface DedupCluster {
  /** 유지할 대표(canonical) 글 id */
  canonical_id: string;
  /** noindex 대상이 되는 중복 글 id 목록 */
  duplicate_ids: string[];
  /** 클러스터 내 최대 유사도 */
  max_similarity: number;
  size: number;
}

export interface DedupOptions {
  /** Jaccard 임계값 (이상이면 중복). 기본 0.75 */
  threshold?: number;
  /** shingle 길이(문자). 기본 9 */
  k?: number;
  /** MinHash permutation 수 = bands * rows. 기본 64 */
  numPerm?: number;
  /** LSH 밴드 수. 기본 16 (rows = numPerm/bands = 4 → 임계 ≈ 0.5, 재현율 확보) */
  bands?: number;
  /** 정규화 후 최소 길이. 미만이면 검출 제외. 기본 200 */
  minLen?: number;
}

const DEFAULTS = { threshold: 0.75, k: 9, numPerm: 64, bands: 16, minLen: 200 };
const UINT32 = 0x100000000;

/** 마크다운/기호 제거 후 한글·영숫자만 남긴 정규화 텍스트. */
export function normalize(text: string): string {
  return (text || "")
    .replace(/!\[.*?\]\(.*?\)/g, " ") // 마크다운 이미지
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // 마크다운 링크 → 텍스트
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[(?:IMAGE|TABLE|INTERNAL_LINK)_SLOT:[^\]]*\]/g, " ") // 슬롯 placeholder
    .replace(/[#`*_>~|\-=]+/g, " ") // 마크다운 기호
    .replace(/[^\w가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 길이 k 문자 shingle 집합. */
export function shingles(text: string, k: number): Set<string> {
  if (text.length < k) return text ? new Set([text]) : new Set();
  const out = new Set<string>();
  for (let i = 0; i <= text.length - k; i++) out.add(text.slice(i, i + k));
  return out;
}

/** FNV-1a 32-bit 해시. seed로 서로 다른 두 베이스 해시를 만든다. */
function fnv1a(str: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * MinHash 시그니처. permutation i 의 해시는 (h1 + i*h2) mod 2^32 (Carter-Wegman 근사).
 * 각 permutation 에 대해 모든 shingle 의 최소값을 취한다.
 */
export function minhashSignature(sh: Set<string>, numPerm: number): number[] {
  const sig = new Array<number>(numPerm).fill(0xffffffff);
  for (const s of sh) {
    const h1 = fnv1a(s, 0);
    const h2 = (fnv1a(s, 0x9e3779b1) | 1) >>> 0; // 홀수 보장
    for (let i = 0; i < numPerm; i++) {
      const v = (h1 + Math.imul(i, h2)) >>> 0;
      if (v < sig[i]) sig[i] = v;
    }
  }
  return sig;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 시그니처를 밴드로 쪼개 밴드별 버킷 키 생성. 같은 키 = LSH 후보. */
function bandKeys(sig: number[], bands: number, rows: number): string[] {
  const keys: string[] = [];
  for (let b = 0; b < bands; b++) {
    let h = 2166136261 >>> 0;
    for (let r = 0; r < rows; r++) {
      const v = sig[b * rows + r];
      h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0;
      h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0;
      h ^= (v >>> 16) & 0xff; h = Math.imul(h, 16777619) >>> 0;
      h ^= (v >>> 24) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    }
    keys.push(`${b}:${h >>> 0}`);
  }
  return keys;
}

/**
 * 중복 클러스터 검출. 각 클러스터의 canonical(대표)은 priority_score 최고,
 * 동률이면 generated_at 최초(가장 먼저 발행된 글)를 유지하고 나머지를 duplicate 로 분류.
 */
export function findDuplicateClusters(posts: DedupInputPost[], options: DedupOptions = {}): DedupCluster[] {
  const opt = { ...DEFAULTS, ...options };
  const rows = Math.max(1, Math.floor(opt.numPerm / opt.bands));
  const numPerm = rows * opt.bands;

  // 1) 정규화 + shingle + 시그니처 (최소 길이 미만 제외)
  const idx: number[] = [];
  const shingleSets: Set<string>[] = [];
  const signatures: number[][] = [];
  posts.forEach((p, i) => {
    const norm = normalize(p.body_markdown);
    if (norm.length < opt.minLen) return;
    const sh = shingles(norm, opt.k);
    idx.push(i);
    shingleSets.push(sh);
    signatures.push(minhashSignature(sh, numPerm));
  });

  // 2) LSH 밴딩으로 후보쌍 수집 (로컬 인덱스 기준)
  const buckets = new Map<string, number[]>();
  signatures.forEach((sig, li) => {
    for (const key of bandKeys(sig, opt.bands, rows)) {
      const arr = buckets.get(key);
      if (arr) arr.push(li);
      else buckets.set(key, [li]);
    }
  });
  const candidatePairs = new Set<string>();
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const lo = Math.min(members[a], members[b]);
        const hi = Math.max(members[a], members[b]);
        candidatePairs.add(`${lo},${hi}`);
      }
    }
  }

  // 3) 후보쌍 정확 Jaccard 검증 → Union-Find
  const n = idx.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const pairSim = new Map<string, number>();
  for (const key of candidatePairs) {
    const [la, lb] = key.split(",").map(Number);
    const sim = jaccard(shingleSets[la], shingleSets[lb]);
    if (sim >= opt.threshold) {
      union(la, lb);
      pairSim.set(key, sim);
    }
  }

  // 4) 클러스터 구성
  const groups = new Map<number, number[]>();
  for (let li = 0; li < n; li++) {
    const root = find(li);
    const arr = groups.get(root);
    if (arr) arr.push(li);
    else groups.set(root, [li]);
  }

  const clusters: DedupCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // canonical 선택: priority_score 내림차순, 동률이면 generated_at 오름차순(최초)
    const sorted = [...members].sort((a, b) => {
      const pa = posts[idx[a]].priority_score ?? 0;
      const pb = posts[idx[b]].priority_score ?? 0;
      if (pb !== pa) return pb - pa;
      const ga = posts[idx[a]].generated_at ?? "";
      const gb = posts[idx[b]].generated_at ?? "";
      return ga < gb ? -1 : ga > gb ? 1 : 0;
    });
    const canonicalLocal = sorted[0];
    let maxSim = 0;
    for (const key of pairSim.keys()) {
      const [la, lb] = key.split(",").map(Number);
      if (members.includes(la) && members.includes(lb)) {
        maxSim = Math.max(maxSim, pairSim.get(key)!);
      }
    }
    clusters.push({
      canonical_id: posts[idx[canonicalLocal]].id,
      duplicate_ids: sorted.slice(1).map((li) => posts[idx[li]].id),
      max_similarity: Number(maxSim.toFixed(4)),
      size: members.length,
    });
  }
  // 큰 클러스터부터
  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}
