# runtime — SEO 양산 실행 모듈

`docs/PROMPT_LIBRARY.md` + `seed_matrix/` 가 설계도라면, 이 폴더는 **실제로 글을 양산하는 코드**.

**핵심 차별점: API 키 없이 `claude` / `codex` CLI 의 OAuth 구독제(Claude Pro·Max / ChatGPT Plus·Pro) 로 본문 생성.** pluck@139.180.189.185:~/bot 의 paperclip-style spawn 패턴 차용.

## 구성

```
runtime/
├─ llm.py                # 메인 — provider 디스패처 + claude/codex 통합 인터페이스
├─ paperclip_runner.py   # 백워드 호환 shim (run_claude → llm.run_llm 위임)
├─ prompts.py            # T01~T07 템플릿 (PROMPT_LIBRARY.md 의 Python 포팅)
├─ slots.py              # CSV 슬롯 로더 + output/state.json 상태 추적
└─ generate.py           # CLI 진입점 (단일/배치 + --provider 플래그)
```

출력 위치: `../output/` (gitignored)
- `{slot_id}.md` — 생성된 markdown 본문
- `{slot_id}.json` — 메타 (provider, cost, duration, model, session_id, slot)
- `state.json` — 슬롯별 status 집계

## Provider 비교

| 항목 | `--provider claude` | `--provider codex` |
|---|---|---|
| CLI 바이너리 | `claude` | `codex` |
| 호출 형태 | `claude --print - --output-format stream-json` | `codex exec --json -` |
| 인증 강제 | `ANTHROPIC_API_KEY` 제거 → claude.ai OAuth | `OPENAI_API_KEY` 제거 → ChatGPT OAuth |
| 자격증명 위치 | `~/.claude/.credentials.json` | `~/.codex/auth.json` |
| 기본 모델 | claude-opus-4-7 (Claude Code 기본) | gpt-5.3-codex (codex CLI 기본) |
| 토큰 카운트 | stream-json `result.usage` | jsonl `turn.completed.usage` |
| Rate limit 신호 | `rate_limit_event` (seven_day utilization) | (codex 는 응답에 별도 신호 없음 — turn.failed 메시지로 파악) |
| 비용 환산 | `total_cost_usd` 필드 (참고용; 구독제라 실제 청구 0) | 별도 환산치 없음 |
| 권장 용도 | 한국어 자연성·길이 안정 | 사실 기반 콘텐츠·구조적 추론 강함 |

**둘 다 OAuth 구독제이므로 사용량은 정액이지만, 각자 한도 모델이 다름:**
- Claude Max 5x ($100): 5h 윈도우 ~225msg / 7-day 한도
- ChatGPT Plus ($20) / Pro ($200): codex 일 한도 별도 (모델별)

→ 두 provider 를 같이 굴리면 **유효 한도 2배**.

## 사전 조건

1. `claude` 와 `codex` CLI 둘 다 설치 + 각자 `login` 완료
   ```bash
   which claude && claude --version
   which codex && codex --version
   ls -la ~/.claude/.credentials.json ~/.codex/auth.json
   ```
2. Python 3.11+ — 외부 패키지 의존성 없음 (표준 라이브러리만 사용)
3. 시드 매트릭스 CSV 준비 — 기본값: `seed_matrix/04_seed_matrix_example.csv`

## 빠른 시작

### 1. PoC — 슬롯 1건 (claude)

```bash
cd /Users/simjaehyeong/Desktop/pluck/tools/seo
python3 -m runtime.generate --slot T07_daa28b5f -v
```

### 2. 같은 슬롯을 codex 로 재생성

```bash
python3 -m runtime.generate --slot T07_361bec18 --provider codex -v
```

### 3. 배치 — 우선순위 상위 5건 (claude + codex 섞어쓰기)

```bash
# claude 로 3건
python3 -m runtime.generate --provider claude --limit 3 --cooldown 60 -v

# codex 로 추가 3건 (claude 와 한도 분리됨)
python3 -m runtime.generate --provider codex --limit 3 --cooldown 90 -v
```

### 4. 템플릿 필터 + 모델 지정

```bash
python3 -m runtime.generate \
  --provider claude \
  --model claude-sonnet-4-6 \
  --templates T01,T03 \
  --min-priority 70 \
  --limit 10 \
  --cooldown 90
```

### 5. 단순 동작 확인

```bash
python3 -c "
import asyncio
from runtime.llm import run_llm

async def t():
    r_c = await run_llm('한 단어로 답해. 안녕.', provider='claude', timeout_sec=60)
    print('claude:', r_c.ok, r_c.model, round(r_c.duration_sec, 1), 's')
    print('  ->', r_c.summary[:120])

    r_x = await run_llm('한 단어로 답해. 안녕.', provider='codex', timeout_sec=60)
    print('codex :', r_x.ok, r_x.model, round(r_x.duration_sec, 1), 's')
    print('  ->', r_x.summary[:120])

asyncio.run(t())
"
```

## CLI 옵션 정리

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--provider claude\|codex` | `claude` | LLM provider |
| `--slot SLOT_ID` | — | 단일 슬롯 강제 실행 (limit/templates 무시) |
| `--csv PATH` | `seed_matrix/04_seed_matrix_example.csv` | 슬롯 CSV |
| `--templates T01,T03` | (없음) | 템플릿 필터 |
| `--min-priority N` | 0 | priority_score 컷오프 |
| `--limit N` | 1 | 배치 최대 건수 |
| `--cooldown SEC` | 60 | 호출 간 간격 |
| `--model MODEL` | (CLI 기본) | provider 별 모델명 |
| `--timeout SEC` | 600 | 호출당 타임아웃 |
| `--cmd PATH` | (none → provider 기본) | CLI 바이너리 경로 |
| `-v` | — | 디버그 로그 |

## 비용/한도 모델

`llm.run_llm()` 은 **항상 OAuth 구독제** 를 강제:
- claude: `env.pop("ANTHROPIC_API_KEY")` + `env.pop("ANTHROPIC_AUTH_TOKEN")`
- codex: `env.pop("OPENAI_API_KEY")` + `env.pop("CODEX_API_KEY")`

따라서 stream-json 의 `total_cost_usd`(claude) 나 `usage`(codex) 는 *환산치/참고용* 이고, 실제 청구는 발생하지 않음.

### 권장 운영치 (혼합 사용 가정)

| 셋업 | 일 권장 | 호출 간격 |
|---|---|---|
| 본인 Claude Pro + ChatGPT Plus | claude 20 + codex 30 = 50건 | 120s |
| Claude Max 5x + ChatGPT Plus | claude 80 + codex 30 = 110건 | 60s |
| Claude Max 5x + ChatGPT Pro | claude 80 + codex 100+ = 180건 | 30s |

## 상태 추적

`output/state.json` 예시:
```json
{
  "T07_daa28b5f": {
    "status": "published",
    "path": "output/T07_daa28b5f.md",
    "cost_usd": 0.31,
    "duration_sec": 24.5,
    "model": "claude-opus-4-7",
    "session_id": "c2e8..."
  }
}
```

배치 재실행 시 `published` 슬롯은 자동 건너뜀. `failed` 는 재시도 대상.

`output/{slot}.json` 에는 provider 도 함께 저장되어, 어떤 LLM 으로 생성됐는지 추적 가능:
```json
{
  "provider": "codex",
  "model": "gpt-5.3-codex",
  "input_tokens": 1234,
  "output_tokens": 2345,
  "cached_input_tokens": 0,
  ...
}
```

## 코드에서 직접 호출

```python
import asyncio
from runtime.llm import run_llm

async def main():
    r = await run_llm(
        prompt="당신은 SEO 작가입니다. ...",
        provider="codex",        # 또는 "claude"
        model="",                # 비우면 CLI 기본
        timeout_sec=300,
    )
    print(r.ok, r.summary[:200])

asyncio.run(main())
```

## 다음 단계 (확장 포인트)

1. **임베딩 + 중복 차단** — OpenAI text-embedding-3-small 또는 로컬 BGE-M3
2. **Supabase 어댑터** — `slots.py` 의 파일 기반 state.json 을 Postgres 로 교체
3. **Vercel 페이지** — `output/{slot_id}.md` 를 Next.js 동적 라우트에서 렌더
4. **provider 자동 선택** — 한쪽 한도 임박 시 자동으로 다른 provider 로 폴백
5. **사후 디덕션** — `scripts/dedup_cluster_v2.py` 를 `output/*.md` 대상으로 cron
6. **GSC Indexing API** — 발행 즉시 색인 요청

## 트러블슈팅

- **"binary not found: 'claude'"** → `which claude` 확인. `--cmd /full/path/to/claude`.
- **"binary not found: 'codex'"** → `npm install -g @openai/codex` 또는 `codex login` 먼저.
- **codex 가 빈 응답** → 첫 실행 시 sandbox 권한 프롬프트가 뜰 수 있음. 한 번 `codex exec "테스트" -` 수동 실행 후 권한 부여.
- **timeout** → `--timeout 900` 으로 늘리거나 cooldown 확장.
- **상태 초기화** → `rm output/state.json` (생성된 .md 는 남음).
- **품질 낮음** → `runtime/prompts.py` 의 해당 템플릿 함수 수정.
