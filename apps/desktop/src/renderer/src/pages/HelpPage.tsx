import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@renderer/components/ui/card";
import { Badge } from "@renderer/components/ui/badge";
import { Separator } from "@renderer/components/ui/separator";
import {
  HelpCircle, Boxes, Rocket, Sparkles, FileText, Settings, ListTodo,
  Download, Database, Terminal, AlertTriangle, Layers,
} from "lucide-react";

export default function HelpPage() {
  const [dbPath, setDbPath] = useState<string>("");

  useEffect(() => {
    // preload 가 reload 되지 않은 dev 환경에서도 죽지 않도록 옵셔널 체이닝.
    window.api?.meta?.dbPath?.()
      .then(setDbPath)
      .catch(() => setDbPath("(조회 실패)"));
  }, []);

  return (
    <div className="p-6 lg:p-8 max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <HelpCircle className="h-6 w-6" />
          <h1 className="text-2xl font-bold">도움말</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          이 앱은 한국어 SEO 콘텐츠를 양산하기 위한 로컬 도구입니다. 모든 데이터는 컴퓨터 안에만 저장되고
          글 생성은 claude.ai / ChatGPT 구독제(OAuth)로 호출됩니다.
        </p>
      </div>

      {/* 전체 워크플로우 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> 전체 워크플로우 (5단계)
          </CardTitle>
          <CardDescription>도메인 추가부터 글 Export까지 한 사이클</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Step
            n={1}
            title="도메인 추가"
            body={
              <>
                사이드바 좌측 상단 <Code>도메인 추가</Code> 버튼 → 다이얼로그에서 도메인/표시 이름/업종 입력.
                업종이 <Code>driving</Code>·<Code>car-mapping</Code>·<Code>general</Code> 이면
                <Code>프리셋 자동 적용</Code> 체크박스로 5축을 한 번에 채울 수 있습니다.
              </>
            }
          />
          <Step
            n={2}
            title="축(Axes) 채우기"
            body={
              <>
                도메인 상세 → <Code>축</Code> 탭. 세 가지 방법:
                <ul className="mt-1 ml-4 list-disc space-y-1">
                  <li><strong>AI 자동 생성</strong> — claude/codex 가 업종 보고 5축을 한 번에 JSON 으로 생성</li>
                  <li><strong>프리셋 적용</strong> — 미리 정의된 업종 프리셋 (driving 등)</li>
                  <li><strong>수동 CSV</strong> — 각 축 카드의 textarea 에 <Code>값,weight,월간검색량,KD</Code> 형식으로 한 줄당 한 값</li>
                </ul>
              </>
            }
          />
          <Step
            n={3}
            title="슬롯 생성"
            body={
              <>
                <Code>슬롯</Code> 탭 상단 <Code>축으로부터 슬롯 생성</Code> 버튼 클릭.
                활성화된 템플릿(T01/T03/T05/T07 기본) × 축 값의 카르테시안 곱으로 슬롯을 만들고
                <Code>priority_score</Code>(검색량·경쟁도·템플릿 가중치 합성)로 정렬합니다.
                <br />
                <span className="text-xs text-muted-foreground">예: 운전면허 프리셋 적용 시 ~200개 슬롯 생성</span>
              </>
            }
          />
          <Step
            n={4}
            title="양산 (글 생성)"
            body={
              <>
                슬롯 체크박스로 선택 → 우측 상단 <Code>양산</Code> 버튼 → 다이얼로그에서 provider/model/cooldown 설정.
                작업이 큐잉되면 자동으로 <Code>작업 큐</Code> 페이지로 이동하고
                백그라운드 워커가 claude/codex 를 순차 호출합니다. 실시간 progress bar 표시.
              </>
            }
          />
          <Step
            n={5}
            title="Export"
            body={
              <>
                <Code>글</Code> 탭에서 다중 선택 → 포맷 선택 (Markdown/Hugo/Next.js MDX) → <Code>Export</Code>.
                폴더 선택 다이얼로그가 열리고, <Code>{"{도메인}/{slug}.md"}</Code> + <Code>_meta.json</Code> 으로 저장됩니다.
              </>
            }
          />
        </CardContent>
      </Card>

      {/* 사이드바 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">사이드바</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="도메인 추가" desc="새 도메인(테넌트) 생성 다이얼로그" />
          <Row label="대시보드" desc="등록된 도메인 카드 목록 + 통계" />
          <Row label="작업 큐" desc="전체 작업 큐 + 실시간 진행률" />
          <Row label="도움말" desc="이 페이지" />
          <Row
            label="도메인 항목"
            desc={
              <>
                각 도메인을 클릭하면 상세 화면(탭 5개)으로 이동. 우측의 숫자는 <strong>발행된 글 수</strong>.
              </>
            }
          />
        </CardContent>
      </Card>

      {/* 도메인 상세 탭 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">도메인 상세 — 5개 탭</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TabHelp
            icon={<Sparkles className="h-4 w-4" />}
            title="개요 (Overview)"
            body={
              <>
                현재 상태를 보고 <strong>다음 단계</strong>를 추천합니다. 슬롯/대기/진행/발행 카운터와
                4단계 워크플로우 체크리스트가 표시됩니다.
              </>
            }
          />
          <TabHelp
            icon={<Sparkles className="h-4 w-4" />}
            title="축 (Axes)"
            body={
              <>
                <strong>region · keyword · intent · persona · modifier</strong> 5개 축을 편집합니다.
                <br />
                <strong>AI 자동 생성</strong>: 업종 + 추가 컨텍스트(선택) → LLM 이 JSON 으로 5축 생성 후 자동 적재.
                <br />
                <strong>프리셋 적용</strong>: 미리 정의된 프리셋으로 한 번에 덮어쓰기.
                <br />
                <strong>각 축 카드</strong>: textarea 에 <Code>값,weight,월간검색량,KD</Code> CSV. 저장 버튼 누를 때만 반영.
              </>
            }
          />
          <TabHelp
            icon={<Boxes className="h-4 w-4" />}
            title="슬롯 (Slots)"
            body={
              <>
                상단에서 <Code>축으로부터 슬롯 생성</Code> 버튼으로 카르테시안 곱 슬롯을 만듭니다.
                <br />
                필터: 상태(대기/진행/발행/실패) · 템플릿 · 키워드 검색.
                체크박스로 다중 선택 후 <Code>양산</Code> 또는 <Code>삭제</Code>.
              </>
            }
          />
          <TabHelp
            icon={<FileText className="h-4 w-4" />}
            title="글 (Posts)"
            body={
              <>
                생성 완료된 글 목록. 제목 클릭 시 미리보기 페이지로 이동(markdown 렌더).
                다중 선택 후 포맷 선택(Markdown / Hugo / Next MDX) → Export 로 폴더에 저장.
              </>
            }
          />
          <TabHelp
            icon={<Settings className="h-4 w-4" />}
            title="설정 (Settings)"
            body={
              <>
                표시 이름·업종·테마·브랜드 컬러·일일 한도 편집. 하단 <strong>위험 구역</strong>에서 도메인 영구 삭제.
              </>
            }
          />
        </CardContent>
      </Card>

      {/* 양산 다이얼로그 옵션 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Rocket className="h-4 w-4" /> 양산 다이얼로그 옵션
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Provider" desc={<><Code>claude</Code> (Anthropic) 또는 <Code>codex</Code> (OpenAI ChatGPT). 둘 다 OAuth 구독제 필요.</>} />
          <Row label="모델" desc={<>비워두면 기본값. claude 는 <Code>sonnet</Code>·<Code>opus</Code>, codex 는 <Code>gpt-5</Code> 등 입력 가능.</>} />
          <Row label="쿨다운" desc="슬롯 간 대기 시간(초). 레이트 리밋 방지용. 0이면 즉시 진행." />
          <Row label="타임아웃" desc="슬롯당 최대 대기 시간(초). 이 시간 안에 응답 없으면 실패 처리." />
        </CardContent>
      </Card>

      {/* Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListTodo className="h-4 w-4" /> 작업 큐 (Jobs)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            각 작업의 progress bar 는 워커가 보내는 실시간 이벤트로 갱신됩니다.
            현재 처리 중인 슬롯 ID 와 슬롯당 소요 시간이 함께 표시됩니다.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            <StatusItem variant="secondary" label="queued" desc="큐에서 대기 중" />
            <StatusItem variant="warning" label="running" desc="현재 실행 중" />
            <StatusItem variant="success" label="done" desc="정상 완료" />
            <StatusItem variant="destructive" label="failed" desc="에러로 종료 또는 취소됨" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            큐 상태(<Code>queued</Code>) 인 작업만 취소 가능. 실행 중인 작업은 현재 슬롯이 끝날 때까지 진행됩니다.
          </p>
        </CardContent>
      </Card>

      {/* Export 포맷 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Download className="h-4 w-4" /> Export 포맷
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Markdown" desc="순수 markdown. front-matter 없음. 가장 호환성 높음." />
          <Row label="Hugo" desc={<>YAML front-matter (<Code>title</Code>·<Code>description</Code>·<Code>date</Code>·<Code>slug</Code>) + 본문</>} />
          <Row label="Next.js MDX" desc={<>YAML front-matter (<Code>title</Code>·<Code>description</Code>·<Code>slug</Code>·<Code>generatedAt</Code>) + 본문</>} />
          <p className="text-xs text-muted-foreground mt-2">
            출력 위치: 선택한 폴더 / <Code>{"{tenant}"}</Code> / <Code>{"{slug}.md"}</Code>.
            메타데이터 인덱스는 <Code>_meta.json</Code> 으로 함께 저장.
          </p>
        </CardContent>
      </Card>

      {/* 인증 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Terminal className="h-4 w-4" /> 인증 (claude / codex 로그인)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            이 앱은 <strong>API 키 빌링이 아니라 구독제 OAuth</strong> 로 LLM 을 호출합니다.
            터미널에서 다음 명령을 한 번 실행해 로그인하세요.
          </p>
          <CodeBlock>{"# Claude (claude.ai Pro/Max)\nclaude login\n\n# Codex (ChatGPT Plus/Pro)\ncodex login"}</CodeBlock>
          <p className="text-xs text-muted-foreground">
            CLI 가 설치되어 있지 않으면 양산 시 <Code>binary not found</Code> 에러가 납니다.
            <br />
            • Claude CLI: <Code>npm i -g @anthropic-ai/claude-code</Code>
            <br />
            • Codex CLI: <Code>brew install codex</Code> 또는 <Code>npm i -g @openai/codex</Code>
          </p>
        </CardContent>
      </Card>

      {/* 데이터 위치 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4" /> 데이터 위치
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>모든 도메인·축·슬롯·글·작업이 아래 SQLite 파일에 저장됩니다.</p>
          <CodeBlock>{dbPath || "(조회 중...)"}</CodeBlock>
          <p className="text-xs text-muted-foreground">
            이 파일을 백업하면 모든 데이터를 보존할 수 있습니다.
            앱을 삭제해도 이 파일은 남고, 다시 설치하면 그대로 이어집니다.
          </p>
        </CardContent>
      </Card>

      {/* 트러블슈팅 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> 자주 발생하는 문제
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Trouble
            sym="양산 시 binary not found: claude"
            sol={<>터미널에서 <Code>which claude</Code> 로 설치 확인. 없으면 <Code>npm i -g @anthropic-ai/claude-code</Code>, 있으면 <Code>claude login</Code>.</>}
          />
          <Trouble
            sym="LLM 호출 결과 empty summary"
            sol={<>레이트 리밋 또는 모델 거부. 쿨다운을 60→120초로 늘리거나 다른 모델로 재시도. 슬롯의 <Code>실패</Code> 상태를 <strong>슬롯 탭에서 reset 후</strong> 다시 양산.</>}
          />
          <Trouble
            sym="AI 자동 축 생성에서 JSON 파싱 실패"
            sol="응답에 마크다운 코드블록이나 설명이 섞인 경우. 다시 한 번 시도하거나 추가 컨텍스트에 'JSON 만 출력' 강조."
          />
          <Trouble
            sym="작업 큐의 진행률이 멈춰 보임"
            sol={<>현재 슬롯의 LLM 응답 대기 중일 수 있음. 슬롯당 평균 30~120초 소요. 너무 오래 걸리면 타임아웃까지 기다리거나 큐의 <Code>취소</Code> (대기 중 작업만 가능).</>}
          />
          <Trouble
            sym="슬롯 생성 시 0개"
            sol={<>해당 템플릿이 요구하는 축이 비어 있거나, 검색량이 <Code>min_sv</Code> 미만. 축 탭에서 검색량을 확인하거나 더 많은 값 추가.</>}
          />
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground text-center">
        Programmatic SEO Desktop · 로컬 전용. 외부로 전송되는 데이터는 LLM 호출 프롬프트 뿐입니다.
      </p>
    </div>
  );
}

/* ---------- 작은 빌딩 블록 ---------- */

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
        {n}
      </div>
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function TabHelp({ icon, title, body }: { icon: React.ReactNode; title: string; body: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
        {icon}
      </div>
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function Row({ label, desc }: { label: string; desc: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <div className="font-mono text-xs text-muted-foreground pt-0.5">{label}</div>
      <div>{desc}</div>
    </div>
  );
}

function StatusItem({
  variant, label, desc,
}: {
  variant: "secondary" | "warning" | "success" | "destructive";
  label: string;
  desc: string;
}) {
  return (
    <div className="rounded-md border p-2">
      <Badge variant={variant} className="text-[10px]">{label}</Badge>
      <div className="text-xs text-muted-foreground mt-1">{desc}</div>
    </div>
  );
}

function Trouble({ sym, sol }: { sym: string; sol: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold">증상: {sym}</div>
      <div className="text-sm text-muted-foreground mt-0.5">해결: {sol}</div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1 py-0.5 rounded bg-muted text-[12px] font-mono">{children}</code>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="rounded-md bg-muted/60 border p-3 text-xs font-mono whitespace-pre-wrap break-all">
      {children}
    </pre>
  );
}
