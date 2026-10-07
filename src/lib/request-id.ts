/**
 * 写操作幂等标识。契约要求每次「新的意图」带一个新的 requestId，重放同一意图必须复用同一个。
 *
 * 放在 lib 里而不是各页面各写一遍：非安全上下文（http 局域网 / 旧浏览器）拿不到
 * `crypto.randomUUID`，兜底实现只该有一份，否则迟早有页面漏兜。
 *
 * 纯函数，客户端可安全 import。
 */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
