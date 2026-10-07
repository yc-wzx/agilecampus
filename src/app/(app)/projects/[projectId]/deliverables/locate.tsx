"use client";

import { useEffect } from "react";

/**
 * 深链接定位（固定来源入口，第 9.1 节）。
 * 通知或证据链接带 ?versionId= / ?feedbackId= 打开成果页时，
 * 服务端已完成高亮，这里只负责把目标滚动到视口中间。
 */
export function LocateTarget({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return;
    const element = document.getElementById(targetId);
    if (element) element.scrollIntoView({ block: "center" });
  }, [targetId]);

  return null;
}
