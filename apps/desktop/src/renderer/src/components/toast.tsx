import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, "id">) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { ...item, id }]);
    setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-md border bg-card shadow-md px-4 py-3 w-80 animate-in slide-in-from-right-2",
              t.variant === "destructive" && "border-destructive/40 bg-destructive/10",
              t.variant === "success" && "border-emerald-500/40 bg-emerald-500/10",
            )}
          >
            <div className="text-sm font-semibold">{t.title}</div>
            {t.description && (
              <div className="text-xs text-muted-foreground mt-1 break-all">{t.description}</div>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast must be inside ToastProvider");
  return v;
}
