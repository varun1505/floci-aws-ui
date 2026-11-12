import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { FlashbarProps } from "@cloudscape-design/components/flashbar";
import { errorMessage } from "./format";

type Notify = {
  items: FlashbarProps.MessageDefinition[];
  success: (text: ReactNode) => void;
  error: (header: string, e: unknown) => void;
  info: (text: ReactNode) => void;
};

const Ctx = createContext<Notify | null>(null);
let seq = 0;

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const push = useCallback((type: FlashbarProps.Type, header: ReactNode, content?: ReactNode) => {
    const id = String(++seq);
    const dismiss = () => setItems((list) => list.filter((i) => i.id !== id));
    setItems((list) => [
      { id, type, header, content, dismissible: true, onDismiss: dismiss },
      ...list.slice(0, 3),
    ]);
    if (type !== "error") setTimeout(dismiss, 6000);
  }, []);

  const value: Notify = {
    items,
    success: (text) => push("success", text),
    info: (text) => push("info", text),
    error: (header, e) => push("error", header, errorMessage(e)),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotify(): Notify {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotify must be used inside NotifyProvider");
  return ctx;
}
