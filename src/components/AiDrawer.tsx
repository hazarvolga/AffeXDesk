import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  RefreshCw,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import {
  api,
  type AiStatus,
  type CopilotAction,
  type CopilotMessage,
} from "../lib/api";
import type { NavTab } from "./OverviewView";

export interface AiDrawerProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
  onRefreshTelemetry: () => Promise<void>;
  onRefreshWorkspaces: () => Promise<void>;
  onNotify: (tone: "success" | "error" | "info", text: string) => void;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  fallback?: boolean;
  actions?: CopilotAction[];
}

const QUICK_CHIPS = [
  "Zombi süreçleri ve yüksek RAM kullanımını analiz et",
  "En çok disk şişiren projeleri ve cache klasörlerini göster",
  "Kirli Git repoları ve proje durumlarını özetle",
  "Sosyal medya köprüsü ve bilgi bankası durumunu kontrol et",
];

function mapActionTab(rawTab: unknown): NavTab {
  switch (String(rawTab || "").toLowerCase()) {
    case "processes":
      return "processes";
    case "workspaces":
    case "projects":
      return "projects";
    case "git":
      return "git";
    case "knowledge":
      return "knowledge";
    case "settings":
      return "settings";
    case "social":
    case "overview":
    default:
      return "overview";
  }
}

export function AiDrawer({
  open,
  onClose,
  onNavigate,
  onRefreshTelemetry,
  onRefreshWorkspaces,
  onNotify,
}: AiDrawerProps) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadStatus = useCallback(async () => {
    setCheckingStatus(true);
    try {
      const res = await api.checkAiStatus();
      setStatus(res);
    } catch {
      setStatus(null);
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadStatus();
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, sending]);

  async function sendPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userEntry: ChatEntry = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };

    const nextEntries = [...entries, userEntry];
    setEntries(nextEntries);
    setInput("");
    setSending(true);

    const payloadMessages: CopilotMessage[] = nextEntries.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    try {
      const reply = await api.aiChat(payloadMessages);
      setEntries((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: reply.message,
          model: reply.model,
          fallback: reply.fallback,
          actions: reply.actions,
        },
      ]);
    } catch (err) {
      onNotify("error", `AI yanıtı alınamadı: ${String(err)}`);
    } finally {
      setSending(false);
    }
  }

  async function handleExecuteAction(action: CopilotAction) {
    if (action.kind === "navigate") {
      const tab = mapActionTab(action.payload?.tab);
      onNavigate(tab);
      onClose();
      return;
    }
    if (action.kind === "scan_processes") {
      await onRefreshTelemetry();
      onNavigate("processes");
      onNotify("info", "Geliştirici süreçleri yeniden tarandı.");
      onClose();
      return;
    }
    if (action.kind === "scan_workspaces") {
      await onRefreshWorkspaces();
      onNavigate("projects");
      onNotify("info", "Çalışma alanları yeniden tarandı.");
      onClose();
      return;
    }
    onNotify("info", `Aksiyon çalıştırıldı: ${action.label}`);
  }

  if (!open) return null;

  const providerLabel =
    status?.provider === "mlx-serve"
      ? "MLX-Serve"
      : status?.provider === "ollama"
      ? "Ollama"
      : status?.online
      ? status.provider
      : "Çevrimdışı (Yerel Çözücü)";

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <aside
        className="ai-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Yerel AI Asistan"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ai-drawer__head">
          <div className="ai-drawer__title-group">
            <div className="ai-drawer__icon">
              <Sparkles size={16} />
            </div>
            <div>
              <h2>Yerel AI Asistan</h2>
              <div className="ai-drawer__status">
                <span
                  className={`badge ${
                    status?.online ? "badge--success" : "badge--warning"
                  }`}
                >
                  {providerLabel}
                </span>
                {status?.model && (
                  <span className="mono muted truncate">{status.model}</span>
                )}
              </div>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="AI durumunu yenile"
              onClick={() => void loadStatus()}
              disabled={checkingStatus}
            >
              <RefreshCw size={14} className={checkingStatus ? "spin" : ""} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="AI çekmecesini kapat"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="ai-drawer__chips" aria-label="Hızlı Komutlar">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className="ai-chip"
              disabled={sending}
              onClick={() => void sendPrompt(chip)}
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="ai-drawer__messages" ref={scrollRef}>
          {entries.length === 0 ? (
            <div className="ai-empty">
              <Bot size={26} className="text-cyan" />
              <p>
                Canlı CPU/RAM telemetrisi, zombi süreçler ve projeleriniz
                hakkında soru sorabilirsiniz.
              </p>
              <span className="mono muted">
                Kısayol: ⌘K / Ctrl+K · Kapat: Esc
              </span>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className={`ai-msg ai-msg--${entry.role}`}
              >
                <div className="ai-msg__meta">
                  {entry.role === "user" ? (
                    <>
                      <User size={12} /> <span>Siz</span>
                    </>
                  ) : (
                    <>
                      <Bot size={12} />{" "}
                      <span>{entry.model || "AffeX AI"}</span>
                      {entry.fallback && (
                        <span className="badge badge--warning">
                          Yerel Çözücü
                        </span>
                      )}
                    </>
                  )}
                </div>
                <p className="ai-msg__body">{entry.content}</p>

                {entry.actions && entry.actions.length > 0 && (
                  <div className="ai-actions">
                    {entry.actions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="ai-action-card"
                        onClick={() => void handleExecuteAction(action)}
                      >
                        <div className="ai-action-card__text">
                          <strong>{action.label}</strong>
                          <span>{action.description}</span>
                        </div>
                        <ArrowRight size={14} className="text-cyan" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          {sending && (
            <div className="ai-msg ai-msg--assistant">
              <div className="ai-msg__meta">
                <RefreshCw size={12} className="spin" />
                <span>Yanıt hazırlanıyor...</span>
              </div>
            </div>
          )}
        </div>

        <form
          className="ai-drawer__composer"
          onSubmit={(e) => {
            e.preventDefault();
            void sendPrompt(input);
          }}
        >
          <input
            ref={inputRef}
            type="text"
            className="text-input"
            placeholder="Bir komut veya soru yazın..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={sending || !input.trim()}
            aria-label="Gönder"
          >
            <Send size={14} />
          </button>
        </form>
      </aside>
    </div>
  );
}
