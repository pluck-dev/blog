import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@renderer/components/ui/card";
import { Badge } from "@renderer/components/ui/badge";
import { Database, Plus } from "lucide-react";
import type { Tenant } from "@shared/types";

export default function Dashboard({ tenants }: { tenants: Tenant[]; onRefresh: () => void }) {
  if (tenants.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="text-center max-w-md">
          <Database className="h-12 w-12 mx-auto text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">시작하기</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            왼쪽 사이드바의 <strong>도메인 추가</strong> 버튼을 눌러 첫 번째 사이트를 등록하세요.
          </p>
          <ol className="text-left text-sm text-muted-foreground mt-6 space-y-2 list-decimal list-inside">
            <li>도메인 추가 (업종 선택 + 프리셋 옵션)</li>
            <li>글 재료 채우기 (AI 자동 / 프리셋 / 수동)</li>
            <li>글 후보 만들기</li>
            <li>예시 글 1개 작성</li>
            <li>괜찮으면 여러 후보 선택 → 글 작성</li>
            <li>완성 글 미리보기 → 내보내기</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">대시보드</h1>
      <p className="text-sm text-muted-foreground mb-6">등록된 도메인 {tenants.length}개</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tenants.map((t) => (
          <Link key={t.domain} to={`/t/${encodeURIComponent(t.domain)}`}>
            <Card className="hover:bg-accent/30 transition-colors h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base truncate">{t.display_name}</CardTitle>
                  <Badge variant="outline" className="text-[10px]">{t.vertical}</Badge>
                </div>
                <CardDescription className="text-xs truncate">{t.domain}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="전체 후보" value={t.slot_count ?? 0} />
                  <Stat label="대기 중" value={t.planned_count ?? 0} />
                  <Stat label="완성 글" value={t.published_count ?? 0} accent />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className={accent ? "text-2xl font-bold text-emerald-600 dark:text-emerald-400" : "text-2xl font-bold"}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
