"""양산 콘텐츠 중복 검출 — MinHash + LSH (TS dedup.ts 포팅, 순수 stdlib).

normalize → shingle(k) → MinHash 시그니처 → LSH 밴딩 후보쌍 → 정확 Jaccard → Union-Find.
경쟁사 분석의 scripts/dedup_cluster_v2.py(datasketch)와 동일 개념이나 외부 의존성 없음.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

UINT32 = 0xFFFFFFFF
_IMG = re.compile(r"!\[.*?\]\(.*?\)")
_LINK = re.compile(r"\[(.*?)\]\(.*?\)")
_URL = re.compile(r"https?://\S+")
_SLOT = re.compile(r"\[(?:IMAGE|TABLE|INTERNAL_LINK)_SLOT:[^\]]*\]")
_MDSYM = re.compile(r"[#`*_>~|\-=]+")
_NONWORD = re.compile(r"[^\w가-힣]+")
_WS = re.compile(r"\s+")


@dataclass
class DedupCluster:
    canonical_id: str
    duplicate_ids: list[str]
    max_similarity: float
    size: int


@dataclass
class _Post:
    id: str
    body_markdown: str
    priority_score: float | None = None
    generated_at: str | None = None


def normalize(text: str) -> str:
    t = text or ""
    t = _IMG.sub(" ", t)
    t = _LINK.sub(r"\1", t)
    t = _URL.sub(" ", t)
    t = _SLOT.sub(" ", t)
    t = _MDSYM.sub(" ", t)
    t = _NONWORD.sub(" ", t)
    return _WS.sub(" ", t).strip()


def shingles(text: str, k: int) -> set[str]:
    if len(text) < k:
        return {text} if text else set()
    return {text[i:i + k] for i in range(len(text) - k + 1)}


def _fnv1a(s: str, seed: int) -> int:
    h = (2166136261 ^ seed) & UINT32
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & UINT32
    return h


def minhash_signature(sh: set[str], num_perm: int) -> list[int]:
    sig = [UINT32] * num_perm
    for s in sh:
        h1 = _fnv1a(s, 0)
        h2 = (_fnv1a(s, 0x9E3779B1) | 1) & UINT32
        for i in range(num_perm):
            v = (h1 + i * h2) & UINT32
            if v < sig[i]:
                sig[i] = v
    return sig


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / (len(a) + len(b) - inter)


def _band_keys(sig: list[int], bands: int, rows: int) -> list[str]:
    keys = []
    for b in range(bands):
        h = 2166136261 & UINT32
        for r in range(rows):
            v = sig[b * rows + r]
            for shift in (0, 8, 16, 24):
                h ^= (v >> shift) & 0xFF
                h = (h * 16777619) & UINT32
        keys.append(f"{b}:{h}")
    return keys


def find_duplicate_clusters(
    posts: list[dict],
    *,
    threshold: float = 0.75,
    k: int = 9,
    num_perm: int = 64,
    bands: int = 16,  # rows=4 → LSH 임계 ~0.5 (재현율 확보, 정확 Jaccard가 최종 필터)
    min_len: int = 200,
) -> list[DedupCluster]:
    rows = max(1, num_perm // bands)
    num_perm = rows * bands

    idx: list[int] = []
    shingle_sets: list[set[str]] = []
    signatures: list[list[int]] = []
    for i, p in enumerate(posts):
        norm = normalize(p.get("body_markdown", ""))
        if len(norm) < min_len:
            continue
        sh = shingles(norm, k)
        idx.append(i)
        shingle_sets.append(sh)
        signatures.append(minhash_signature(sh, num_perm))

    # LSH 밴딩 후보쌍
    buckets: dict[str, list[int]] = {}
    for li, sig in enumerate(signatures):
        for key in _band_keys(sig, bands, rows):
            buckets.setdefault(key, []).append(li)
    candidate_pairs: set[tuple[int, int]] = set()
    for members in buckets.values():
        if len(members) < 2:
            continue
        for a in range(len(members)):
            for b in range(a + 1, len(members)):
                lo, hi = sorted((members[a], members[b]))
                candidate_pairs.add((lo, hi))

    n = len(idx)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    pair_sim: dict[tuple[int, int], float] = {}
    for la, lb in candidate_pairs:
        sim = jaccard(shingle_sets[la], shingle_sets[lb])
        if sim >= threshold:
            union(la, lb)
            pair_sim[(la, lb)] = sim

    groups: dict[int, list[int]] = {}
    for li in range(n):
        groups.setdefault(find(li), []).append(li)

    clusters: list[DedupCluster] = []
    for members in groups.values():
        if len(members) < 2:
            continue

        def sort_key(li: int):
            p = posts[idx[li]]
            return (-(p.get("priority_score") or 0), p.get("generated_at") or "")

        ordered = sorted(members, key=sort_key)
        canonical = ordered[0]
        member_set = set(members)
        max_sim = 0.0
        for (la, lb), s in pair_sim.items():
            if la in member_set and lb in member_set:
                max_sim = max(max_sim, s)
        clusters.append(DedupCluster(
            canonical_id=posts[idx[canonical]]["id"],
            duplicate_ids=[posts[idx[li]]["id"] for li in ordered[1:]],
            max_similarity=round(max_sim, 4),
            size=len(members),
        ))

    clusters.sort(key=lambda c: -c.size)
    return clusters
