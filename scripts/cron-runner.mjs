const secret = process.env.CRON_SECRET;
const target = process.env.CRON_TARGET ?? "http://app:3000/api/cron/reminders";
if (!secret || secret.length < 32)
  throw Error("CRON_SECRET must be configured");
const interval = Number(process.env.CRON_INTERVAL_MS ?? 300000);
if (!Number.isFinite(interval) || interval < 60000)
  throw Error("Cron interval must be at least one minute");
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) console.error("[reminders] HTTP", response.status);
    else {
      const data = await response.json();
      console.log(
        "[reminders]",
        JSON.stringify({
          created: data.reminders?.created,
          failed: data.reminders?.failed,
          externalSent: data.external?.sent,
          externalFailed: data.external?.failed,
          outboxFailed: data.outboxFailed,
        }),
      );
    }
  } catch {
    console.error("[reminders] request failed");
  } finally {
    running = false;
  }
}
await tick();
const timer = setInterval(tick, interval);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    process.exit(0);
  });
