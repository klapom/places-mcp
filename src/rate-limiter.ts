import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RateLimitConfig {
  maxPerHour: number;
  maxPerMonth: number;
  usageFile: string;
}

interface UsageData {
  hourly: Record<string, number>; // key: "2026-02-19T10" → count
  monthly: Record<string, number>; // key: "2026-02"       → count
}

export function loadRateLimitConfig(): RateLimitConfig {
  return {
    maxPerHour: Number.parseInt(process.env.MAX_REQUESTS_PER_HOUR ?? "60"),
    maxPerMonth: Number.parseInt(process.env.MAX_REQUESTS_PER_MONTH ?? "5000"),
    usageFile: process.env.USAGE_FILE ?? join(homedir(), ".places-mcp", "usage.json"),
  };
}

function currentHourKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function loadUsage(file: string): UsageData {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as UsageData;
  } catch {
    return { hourly: {}, monthly: {} };
  }
}

function saveUsage(file: string, data: UsageData): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

function pruneOldKeys(data: UsageData): void {
  const currentMonth = currentMonthKey();
  const currentHour = currentHourKey();

  // Keep only current month in monthly
  for (const key of Object.keys(data.monthly)) {
    if (key < currentMonth) delete data.monthly[key];
  }
  // Keep only last 48 hours in hourly
  const cutoff = new Date();
  cutoff.setUTCHours(cutoff.getUTCHours() - 48);
  for (const key of Object.keys(data.hourly)) {
    if (key < currentHour) delete data.hourly[key];
  }
}

export class RateLimiter {
  constructor(private config: RateLimitConfig) {}

  /**
   * Check limits and increment counters. Throws if limit exceeded.
   * Returns current usage stats.
   */
  check(): { hourUsed: number; monthUsed: number } {
    const data = loadUsage(this.config.usageFile);
    pruneOldKeys(data);

    const hourKey = currentHourKey();
    const monthKey = currentMonthKey();

    const hourUsed = data.hourly[hourKey] ?? 0;
    const monthUsed = data.monthly[monthKey] ?? 0;

    if (hourUsed >= this.config.maxPerHour) {
      throw new Error(
        `Stundenlimit erreicht (${hourUsed}/${this.config.maxPerHour} Anfragen). Bitte in einer Stunde erneut versuchen.`,
      );
    }

    if (monthUsed >= this.config.maxPerMonth) {
      throw new Error(
        `Monatslimit erreicht (${monthUsed}/${this.config.maxPerMonth} Anfragen). Limit wird am 1. des nächsten Monats zurückgesetzt.`,
      );
    }

    // Increment
    data.hourly[hourKey] = hourUsed + 1;
    data.monthly[monthKey] = monthUsed + 1;
    saveUsage(this.config.usageFile, data);

    return { hourUsed: hourUsed + 1, monthUsed: monthUsed + 1 };
  }

  /** Returns current usage without incrementing. */
  status(): {
    hourUsed: number;
    hourLimit: number;
    monthUsed: number;
    monthLimit: number;
    hourKey: string;
    monthKey: string;
  } {
    const data = loadUsage(this.config.usageFile);
    return {
      hourUsed: data.hourly[currentHourKey()] ?? 0,
      hourLimit: this.config.maxPerHour,
      monthUsed: data.monthly[currentMonthKey()] ?? 0,
      monthLimit: this.config.maxPerMonth,
      hourKey: currentHourKey(),
      monthKey: currentMonthKey(),
    };
  }
}
