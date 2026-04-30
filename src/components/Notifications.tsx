import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

export interface NotifyDetail {
  title: string;
  message?: string;
  elapsed?: number;
  variant?: "success" | "error";
}

interface Notif extends NotifyDetail {
  id: number;
}

let nextId = 1;

function formatElapsed(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function notify(detail: NotifyDetail): void {
  window.dispatchEvent(new CustomEvent("alice:notify", { detail }));
}

export function Notifications() {
  const [items, setItems] = useState<Notif[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NotifyDetail>).detail;
      if (!detail) return;
      setItems((prev) => [
        ...prev,
        {
          id: nextId++,
          variant: "success",
          ...detail,
        },
      ]);
    };
    window.addEventListener("alice:notify", handler);
    return () => window.removeEventListener("alice:notify", handler);
  }, []);

  function close(id: number) {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <div className="alice-notif-stack">
      {items.map((n) => {
        const isError = n.variant === "error";
        const Icon = isError ? AlertCircle : CheckCircle2;
        return (
          <div
            key={n.id}
            className={`alice-notif ${isError ? "alice-notif--error" : "alice-notif--success"}`}
            role="status"
          >
            <Icon size={18} className="alice-notif__icon" />
            <div className="alice-notif__body">
              <div className="alice-notif__title">{n.title}</div>
              {n.elapsed != null && (
                <div className="alice-notif__sub">
                  Durée : {formatElapsed(n.elapsed)}
                </div>
              )}
              {n.message && <div className="alice-notif__msg">{n.message}</div>}
            </div>
            <button
              type="button"
              className="alice-notif__close"
              onClick={() => close(n.id)}
              aria-label="Fermer"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
