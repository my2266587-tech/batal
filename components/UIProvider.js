"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// In-app replacements for the browser's alert() / confirm() / prompt(),
// plus short toast messages. Usage inside any page:
//   const ui = useUI();
//   if (!(await ui.confirm({ title: "למחוק?", danger: true }))) return;
//   ui.toast("נשמר");             // green
//   ui.toast("נכשל", "error");    // red
//   const text = await ui.prompt({ title: "הערה", defaultValue: "" }); // null = cancel
// Dialogs: focus starts on "ביטול" (or the text field), Esc cancels.

const UIContext = createContext(null);

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
}

function Dialog({ dialog, onClose }) {
  const cancelRef = useRef(null);
  const okRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState(dialog.defaultValue ?? "");

  useEffect(() => {
    if (dialog.kind === "prompt") inputRef.current?.focus();
    else if (dialog.kind === "alert") okRef.current?.focus();
    else cancelRef.current?.focus();
  }, [dialog.kind]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose(dialog.kind === "prompt" ? null : false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog.kind, onClose]);

  const ok = () => onClose(dialog.kind === "prompt" ? value : true);
  const cancel = () => onClose(dialog.kind === "prompt" ? null : false);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={cancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-dialog-title"
        className="card w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {dialog.title && (
          <h2 id="ui-dialog-title" className="text-lg font-bold text-ink-900">
            {dialog.title}
          </h2>
        )}
        {dialog.message && (
          <div className="text-base text-ink-700 whitespace-pre-line max-h-[50vh] overflow-y-auto">
            {dialog.message}
          </div>
        )}
        {dialog.kind === "prompt" && (
          <textarea
            ref={inputRef}
            className="input min-h-[90px]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="flex gap-3 justify-end flex-wrap">
          {dialog.kind !== "alert" && (
            <button ref={cancelRef} type="button" className="btn-ghost min-h-[44px]" onClick={cancel}>
              ביטול
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            className={
              "btn-primary min-h-[44px] " + (dialog.danger ? "bg-red-600 hover:bg-red-700" : "")
            }
            onClick={ok}
          >
            {dialog.confirmText || (dialog.kind === "alert" ? "הבנתי" : "אישור")}
          </button>
        </div>
      </div>
    </div>
  );
}

let toastSeq = 0;

export default function UIProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const resolverRef = useRef(null);

  const open = useCallback(
    (kind, opts) =>
      new Promise((resolve) => {
        const o = typeof opts === "string" ? { message: opts } : opts || {};
        resolverRef.current = resolve;
        setDialog({ ...o, kind, id: Date.now() });
      }),
    [],
  );

  const close = useCallback((result) => {
    setDialog(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(result);
  }, []);

  const toast = useCallback((message, type = "success") => {
    toastSeq += 1;
    const id = toastSeq;
    setToasts((ts) => [...ts, { id, message, type }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), type === "error" ? 7000 : 3500);
  }, []);

  const [api] = useState(() => ({}));
  api.confirm = (o) => open("confirm", o);
  api.alert = (o) => open("alert", o);
  api.prompt = (o) => open("prompt", o);
  api.toast = toast;

  return (
    <UIContext.Provider value={api}>
      {children}
      {dialog && <Dialog key={dialog.id} dialog={dialog} onClose={close} />}
      <div
        className="fixed bottom-4 inset-x-4 md:inset-x-auto md:left-6 z-[70] flex flex-col gap-2 items-stretch md:items-start pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "pointer-events-auto rounded-xl px-5 py-3 text-base font-medium shadow-lg text-white " +
              (t.type === "error" ? "bg-red-600" : "bg-emerald-600")
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}
