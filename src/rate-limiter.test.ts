import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter, loadRateLimitConfig } from "./rate-limiter.js";

describe("loadRateLimitConfig", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns defaults when env vars are unset", () => {
    // biome-ignore lint/performance/noDelete: env-var unset must be `delete` — assignment sets string "undefined"
    delete process.env.MAX_REQUESTS_PER_HOUR;
    // biome-ignore lint/performance/noDelete: env-var unset must be `delete` — assignment sets string "undefined"
    delete process.env.MAX_REQUESTS_PER_MONTH;
    // biome-ignore lint/performance/noDelete: env-var unset must be `delete` — assignment sets string "undefined"
    delete process.env.USAGE_FILE;
    const cfg = loadRateLimitConfig();
    expect(cfg.maxPerHour).toBe(60);
    expect(cfg.maxPerMonth).toBe(5000);
    expect(cfg.usageFile).toContain("usage.json");
  });

  it("reads env vars when set", () => {
    process.env.MAX_REQUESTS_PER_HOUR = "10";
    process.env.MAX_REQUESTS_PER_MONTH = "200";
    process.env.USAGE_FILE = "/tmp/test-usage.json";
    const cfg = loadRateLimitConfig();
    expect(cfg.maxPerHour).toBe(10);
    expect(cfg.maxPerMonth).toBe(200);
    expect(cfg.usageFile).toBe("/tmp/test-usage.json");
  });
});

describe("RateLimiter", () => {
  let tmpDir: string;
  let usageFile: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T14:30:00Z"));
    tmpDir = mkdtempSync(join(tmpdir(), "rl-test-"));
    usageFile = join(tmpDir, "usage.json");
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeLimiter(maxPerHour = 60, maxPerMonth = 5000): RateLimiter {
    return new RateLimiter({ maxPerHour, maxPerMonth, usageFile });
  }

  it("check() increments hourly and monthly counters", () => {
    const rl = makeLimiter();
    const result = rl.check();
    expect(result.hourUsed).toBe(1);
    expect(result.monthUsed).toBe(1);

    const result2 = rl.check();
    expect(result2.hourUsed).toBe(2);
    expect(result2.monthUsed).toBe(2);
  });

  it("check() throws when hourly limit exceeded", () => {
    const rl = makeLimiter(2, 5000);
    rl.check();
    rl.check();
    expect(() => rl.check()).toThrowError(/Stundenlimit erreicht.*2\/2/);
  });

  it("check() throws when monthly limit exceeded", () => {
    const rl = makeLimiter(5000, 2);
    rl.check();
    rl.check();
    expect(() => rl.check()).toThrowError(/Monatslimit erreicht.*2\/2/);
  });

  it("check() persists counts across instances", () => {
    const rl1 = makeLimiter();
    rl1.check();
    rl1.check();

    const rl2 = makeLimiter();
    const result = rl2.check();
    expect(result.hourUsed).toBe(3);
    expect(result.monthUsed).toBe(3);
  });

  it("status() returns counts without incrementing", () => {
    const rl = makeLimiter(60, 5000);
    rl.check();
    rl.check();

    const status = rl.status();
    expect(status.hourUsed).toBe(2);
    expect(status.monthUsed).toBe(2);
    expect(status.hourLimit).toBe(60);
    expect(status.monthLimit).toBe(5000);
    expect(status.hourKey).toBe("2026-02-19T14");
    expect(status.monthKey).toBe("2026-02");

    // Calling status again should not change counts
    const status2 = rl.status();
    expect(status2.hourUsed).toBe(2);
  });

  it("prunes old hour keys on load", () => {
    const rl = makeLimiter();
    rl.check(); // count at 2026-02-19T14

    // Advance 49 hours — old key should be pruned
    vi.setSystemTime(new Date("2026-02-21T15:30:00Z"));
    const status = rl.status();
    expect(status.hourUsed).toBe(0); // old key pruned
  });

  it("prunes old month keys on check", () => {
    const rl = makeLimiter();
    rl.check(); // count in 2026-02

    // Advance to next month
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const result = rl.check();
    expect(result.monthUsed).toBe(1); // old month pruned, fresh count
  });

  it("returns empty counts when usage file does not exist", () => {
    const rl = makeLimiter();
    const status = rl.status();
    expect(status.hourUsed).toBe(0);
    expect(status.monthUsed).toBe(0);
  });

  it("creates parent directories for usage file", () => {
    const deepFile = join(tmpDir, "a", "b", "c", "usage.json");
    const rl = new RateLimiter({ maxPerHour: 60, maxPerMonth: 5000, usageFile: deepFile });
    rl.check();
    const data = JSON.parse(readFileSync(deepFile, "utf-8"));
    expect(data.hourly["2026-02-19T14"]).toBe(1);
  });
});
