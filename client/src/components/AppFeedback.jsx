import { createContext, useContext, useMemo, useRef, useState } from "react";

const ToastContext = createContext(null);
const ConfirmContext = createContext(null);

function ToastStack({ toasts, dismissToast }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-card toast-${toast.tone || "info"}`}>
          <div>
            {toast.title && <strong>{toast.title}</strong>}
            {toast.message && <p>{toast.message}</p>}
          </div>
          <button className="toast-dismiss" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({ dialog, onClose }) {
  if (!dialog) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <p className="eyebrow">{dialog.eyebrow || "Confirm action"}</p>
        <h2 id="confirm-title">{dialog.title}</h2>
        {dialog.description && <p className="muted">{dialog.description}</p>}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={() => onClose(false)}>
            {dialog.cancelLabel || "Cancel"}
          </button>
          <button className={`btn ${dialog.confirmTone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={() => onClose(true)}>
            {dialog.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppFeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const confirmResolver = useRef(null);
  const timeoutHandles = useRef(new Map());

  function dismissToast(id) {
    const timeoutId = timeoutHandles.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutHandles.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function pushToast(toast) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextToast = {
      id,
      tone: "info",
      ...toast,
    };
    setToasts((current) => [...current, nextToast]);
    const timeoutId = window.setTimeout(() => dismissToast(id), toast.duration ?? 4200);
    timeoutHandles.current.set(id, timeoutId);
  }

  function requestConfirmation(options) {
    return new Promise((resolve) => {
      confirmResolver.current = resolve;
      setDialog(options);
    });
  }

  function closeDialog(confirmed) {
    if (confirmResolver.current) confirmResolver.current(confirmed);
    confirmResolver.current = null;
    setDialog(null);
  }

  const toastApi = useMemo(() => ({
    pushToast,
    success(message, title = "Saved") {
      pushToast({ tone: "success", title, message });
    },
    error(message, title = "Something went wrong") {
      pushToast({ tone: "error", title, message });
    },
    info(message, title = "Heads up") {
      pushToast({ tone: "info", title, message });
    },
  }), []);

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={requestConfirmation}>
        {children}
        <ToastStack toasts={toasts} dismissToast={dismissToast} />
        <ConfirmDialog dialog={dialog} onClose={closeDialog} />
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
