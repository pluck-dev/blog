import { HashRouter, Routes, Route, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { ListTodo, LayoutDashboard, Plus, Database, HelpCircle } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import TenantDetail from "./pages/TenantDetail";
import PostDetail from "./pages/PostDetail";
import JobsPage from "./pages/JobsPage";
import HelpPage from "./pages/HelpPage";
import NewTenantDialog from "./components/NewTenantDialog";
import { ToastProvider, useToast } from "./components/toast";
import ErrorBoundary from "./components/ErrorBoundary";
import { cn } from "./lib/utils";
import type { Tenant } from "@shared/types";

function Sidebar({ tenants, onRefresh }: { tenants: Tenant[]; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  return (
    <aside className="dark w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 text-zinc-100 flex flex-col">
      <div className="h-11 px-4 flex items-center gap-2 border-b border-zinc-800">
        <Database className="h-4 w-4 text-zinc-400" />
        <span className="font-semibold text-sm">SEO Desktop</span>
      </div>

      <div className="px-3 py-3 [-webkit-app-region:no-drag]">
        <button
          onClick={() => setOpen(true)}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-zinc-100 text-zinc-900 hover:bg-white text-sm font-medium h-8"
        >
          <Plus className="h-4 w-4" /> 도메인 추가
        </button>
      </div>

      <nav className="px-2 flex-1 overflow-y-auto">
        <NavItem to="/" icon={<LayoutDashboard className="h-4 w-4" />} label="대시보드" />
        <NavItem to="/jobs" icon={<ListTodo className="h-4 w-4" />} label="작업 큐" />
        <NavItem to="/help" icon={<HelpCircle className="h-4 w-4" />} label="도움말" />

        {tenants.length > 0 && (
          <div className="mt-4 mb-1 px-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
            도메인 ({tenants.length})
          </div>
        )}
        {tenants.map((t) => (
          <NavLink
            key={t.domain}
            to={`/t/${encodeURIComponent(t.domain)}`}
            className={({ isActive }) =>
              cn(
                "flex items-center justify-between gap-2 px-2 py-1.5 rounded text-sm",
                isActive ? "bg-zinc-800 text-white" : "text-zinc-300 hover:bg-zinc-900",
              )
            }
          >
            <span className="truncate">{t.display_name}</span>
            <span className="text-[10px] text-zinc-500 shrink-0">{t.published_count ?? 0}</span>
          </NavLink>
        ))}
      </nav>

      <NewTenantDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(domain) => {
          toast({ title: "도메인 생성됨", description: domain });
          onRefresh();
          navigate(`/t/${encodeURIComponent(domain)}?tab=axes`);
        }}
      />
    </aside>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 px-2 py-1.5 rounded text-sm",
          isActive ? "bg-zinc-800 text-white" : "text-zinc-300 hover:bg-zinc-900",
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function Shell() {
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const refresh = useCallback(async () => {
    if (!window.api?.tenants) return;
    const list = await window.api.tenants.list();
    setTenants(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar tenants={tenants} onRefresh={refresh} />
      <main className="flex-1 overflow-y-auto min-w-0">
        <RoutedContent tenants={tenants} refresh={refresh} />
      </main>
    </div>
  );
}

function RoutedContent({ tenants, refresh }: { tenants: Tenant[]; refresh: () => void }) {
  // location 변화에 따라 ErrorBoundary 를 reset 하기 위해 location.key 를 ErrorBoundary 의 key 로 사용.
  const location = useLocation();
  return (
    <ErrorBoundary key={location.key}>
      <Routes>
        <Route path="/" element={<Dashboard tenants={tenants} onRefresh={refresh} />} />
        <Route path="/t/:domain" element={<TenantDetail onRefresh={refresh} />} />
        <Route path="/t/:domain/post/:postId" element={<PostDetail />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ToastProvider>
  );
}
