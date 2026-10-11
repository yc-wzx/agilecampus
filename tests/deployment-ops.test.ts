import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

const mocks = vi.hoisted(() => ({
  fs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));
vi.mock("node:fs", () => ({ default: mocks.fs }));
vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  spawnSync: mocks.spawnSync,
}));

const revision = "1234567890abcdef1234567890abcdef12345678";
const previousRevision = "abcdef1234567890abcdef1234567890abcdef12";
const currentTag = "agilecampus:release-1234567890ab";
const migrationTag = "agilecampus:migrate-1234567890ab";
const previousTag = "agilecampus:release-abcdef123456";
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
let marker: Record<string, unknown>;
let writes: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  writes = new Map();
  marker = {
    revision: previousRevision,
    image: previousTag,
    previousImage: null,
  };
  mocks.fs.existsSync.mockImplementation(
    (file: string) => file.endsWith(".env") || file.endsWith(".release.json"),
  );
  mocks.fs.readFileSync.mockImplementation((file: string) => {
    if (file.endsWith(".env"))
      return Buffer.from(
        [
          `POSTGRES_PASSWORD=${"a".repeat(64)}`,
          `AUTH_SECRET=${"b".repeat(64)}`,
          `CRON_SECRET=${"c".repeat(64)}`,
          "POSTGRES_DB=agilecampus",
          `DATABASE_URL=postgres://agilecampus:${"a".repeat(64)}@db:5432/agilecampus`,
          "AGILECAMPUS_URL=https://campus.example.test",
          "AUTH_URL=https://campus.example.test",
          "DOMAIN=campus.example.test",
          `APP_IMAGE=${previousTag}`,
        ].join("\n"),
      );
    if (file.endsWith(".release.json")) return JSON.stringify(marker);
    return Buffer.from("synthetic backup bytes");
  });
  mocks.fs.writeFileSync.mockImplementation((file: string, data: string) =>
    writes.set(file, data),
  );
  mocks.fs.statSync.mockReturnValue({ size: 22 });
  mocks.fs.createWriteStream.mockImplementation(
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
  );
  mocks.spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: Readable };
    child.stdout = Readable.from([Buffer.from("synthetic backup bytes")]);
    setImmediate(() => child.emit("close", 0));
    return child;
  });
  mocks.spawnSync.mockImplementation((binary: string, args: string[]) => ({
    status: 0,
    stdout: binary === "git" && args[0] === "rev-parse" ? revision : "",
  }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function execute(operation: string, argument?: string) {
  process.argv = [
    process.execPath,
    "scripts/ops.mjs",
    operation,
    ...(argument ? [argument] : []),
  ];
  await import("../scripts/ops.mjs");
}
function recordedRelease() {
  const entry = [...writes].find(([file]) => file.endsWith(".release.json"));
  if (!entry) throw Error("Expected a successful release record");
  return JSON.parse(entry[1]);
}

describe("production operations orchestration (Docker processes simulated)", () => {
  it("uses both matching prebuilt images without building and still backs up before migration", async () => {
    mocks.spawnSync.mockImplementation((binary: string, args: string[]) => ({
      status: 0,
      stdout:
        (binary === "git" && args[0] === "rev-parse") ||
        (binary === "docker" && args[0] === "image")
          ? revision
          : "",
    }));
    await execute("release", "--prebuilt");
    expect(process.exitCode).not.toBe(1);
    const calls = mocks.spawnSync.mock.calls;
    expect(calls.filter(([, args]) => args[0] === "image").map(([, args]) => args[2]))
      .toEqual([currentTag, migrationTag]);
    expect(calls.some(([, args]) => args.includes("build"))).toBe(false);
    const migrationIndex = calls.findIndex(([, args]) => args.includes("run"));
    expect(calls[migrationIndex][1]).toEqual(
      expect.arrayContaining(["run", "--rm", "--pull", "never", "migrate"]),
    );
    expect(calls[migrationIndex][1]).not.toContain("--build");
    expect(calls[migrationIndex][1]).not.toContain("--no-build");
    expect(calls[migrationIndex][2].env.MIGRATE_IMAGE).toBe(migrationTag);
    expect(mocks.spawn.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawnSync.mock.invocationCallOrder[migrationIndex],
    );
    expect(recordedRelease()).toMatchObject({ image: currentTag, migrationImage: migrationTag });
  });

  it.each(["missing app", "mismatched migration"])(
    "rejects %s before any backup, migration or service stop",
    async (failure) => {
      mocks.spawnSync.mockImplementation((binary: string, args: string[]) => ({
        status: failure === "missing app" && args[0] === "image" ? 1 : 0,
        stdout:
          binary === "git" && args[0] === "rev-parse"
            ? revision
            : args[0] === "image"
              ? args[2] === migrationTag ? previousRevision : revision
              : "",
      }));
      await execute("release", "--prebuilt");
      expect(process.exitCode).toBe(1);
      expect(mocks.spawn).not.toHaveBeenCalled();
      expect(mocks.spawnSync.mock.calls.some(([, args]) => args.includes("stop") || args.includes("up") || args.includes("run"))).toBe(false);
      expect(writes.size).toBe(0);
    },
  );

  it("builds a fresh release tag, preserves the prior image, backs up before migration and starts that exact tag", async () => {
    await execute("release");
    const docker = mocks.spawnSync.mock.calls.filter(
      ([binary]) => binary === "docker",
    );
    const build = docker.find(([, args]) => args.includes("build"));
    expect(build?.[2].env.APP_IMAGE).toBe(currentTag);
    expect(build?.[2].env.MIGRATE_IMAGE).toBe(migrationTag);
    expect(build?.[2].env.SOURCE_REVISION).toBe(revision);
    const up = docker.find(
      ([, args]) => args.includes("up") && args.includes("reminders"),
    );
    expect(up?.[2].env.APP_IMAGE).toBe(currentTag);
    expect(up?.[1]).toContain("--no-build");
    const edge = docker.find(([, args]) => args.includes("edge"));
    expect(edge?.[1]).toContain("--no-deps");
    expect(recordedRelease()).toMatchObject({
      image: currentTag,
      revision,
      previousImage: previousTag,
      previousRevision,
    });
    const invocations = mocks.spawnSync.mock.invocationCallOrder;
    const migrationIndex = mocks.spawnSync.mock.calls.findIndex(
      ([, args]) => args.includes("run") && args.includes("migrate"),
    );
    expect(mocks.spawn.mock.invocationCallOrder[0]).toBeLessThan(
      invocations[migrationIndex],
    );
  });

  it("leaves the running app and successful record untouched when building fails", async () => {
    mocks.spawnSync.mockImplementation((binary: string, args: string[]) => ({
      status: binary === "docker" && args.includes("build") ? 1 : 0,
      stdout: binary === "git" && args[0] === "rev-parse" ? revision : "",
    }));
    await execute("release");
    expect(process.exitCode).toBe(1);
    expect(
      mocks.spawnSync.mock.calls.some(([, args]) => args.includes("stop")),
    ).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(writes.size).toBe(0);
  });

  it("rolls back only app/reminders without rebuilding or migrating, and records the running version", async () => {
    marker = {
      revision,
      image: currentTag,
      previousImage: previousTag,
      previousRevision,
    };
    await execute("rollback", previousTag);
    const docker = mocks.spawnSync.mock.calls.filter(
      ([binary]) => binary === "docker",
    );
    expect(docker).toHaveLength(2);
    expect(docker[1][1]).toEqual(
      expect.arrayContaining(["--no-build", "--no-deps", "app", "reminders"]),
    );
    expect(docker[1][2].env.APP_IMAGE).toBe(previousTag);
    expect(recordedRelease()).toMatchObject({
      image: previousTag,
      revision: previousRevision,
      previousImage: currentTag,
      previousRevision: revision,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
