"use client";
import { useRef, useState, type FormEvent } from "react";
import type { ExtraState } from "./actions";

// Keep inputs and requestId on failure; fetch a fresh document once after a confirmed write.
export function useExtraSubmit(
  execute: (previous: ExtraState, form: FormData) => Promise<ExtraState>,
) {
  const [state, setState] = useState<ExtraState>(null);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = new FormData(event.currentTarget);
    locked.current = true;
    setPending(true);
    setState(null);
    try {
      const result = await execute(state, form);
      if (result?.ok) window.location.reload();
      else setState(result);
    } catch {
      setState({
        ok: false,
        code: "INTERNAL",
        message: "未能确认保存结果，请刷新核对或重试；重试会复用原请求标识。",
      });
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return { state, pending, onSubmit };
}
