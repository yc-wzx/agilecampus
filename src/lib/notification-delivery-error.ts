export class NotificationDeliveryError extends Error {
  constructor(
    public readonly certainty: "rejected" | "uncertain",
    public readonly code: string,
  ) {
    super("外部通知发送未完成");
  }
}
