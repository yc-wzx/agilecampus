/**
 * B 的展示组件共用的格式化。
 * 时间统一按北京时间展示，避免各卡片各写一套。
 */
export function formatAsOf(value: string | null | undefined): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
