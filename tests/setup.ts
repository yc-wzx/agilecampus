import { config } from "dotenv";
config({ path: ".env.test" });
import { afterAll } from "vitest";
afterAll(async () => {
  const { drainPendingTaskNotifications } = await import("@/lib/notify");
  await drainPendingTaskNotifications();
});
