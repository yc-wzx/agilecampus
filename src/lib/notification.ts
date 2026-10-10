// P0–P2 统一接口标准 §9.2 的固定入口；保留 F 原有 plural 文件给旧调用方。
export {
  dispatchExternalNotifications,
  getMyNotificationChannels,
} from "./external-notifications";
export {
  listMyNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  recordNotificationIntent,
} from "./notifications";
