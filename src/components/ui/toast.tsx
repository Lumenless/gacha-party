"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertCircle, X } from "lucide-react";

type ToastItem = { id: number; message: string };
type ToastContextValue = { error: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);
let nextToastId = 0;

function ErrorToast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 6_000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id]);

  return (
    <div role="alert" className="flex w-full items-start gap-3 rounded-lg border border-destructive/40 bg-card p-4 text-sm shadow-2xl sm:w-96">
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">Something went wrong</p>
        <p className="mt-1 break-words leading-5 text-muted-foreground">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-m-2 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Dismiss error"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const error = useCallback((message: string) => {
    const toast = { id: ++nextToastId, message };
    setToasts((current) => [...current.filter((item) => item.message !== message), toast].slice(-3));
  }, []);
  const value = useMemo(() => ({ error }), [error]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 top-20 z-[200] flex flex-col items-end gap-2 sm:left-auto sm:right-6">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full sm:w-auto">
            <ErrorToast toast={toast} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}
