import { GetScheduleCommand, type GetScheduleCommandOutput, ListScheduleGroupsCommand, ListSchedulesCommand, type ScheduleGroupSummary } from "@aws-sdk/client-scheduler";
import { scheduler } from "../../clients/scheduler";

export type Schedule = Omit<GetScheduleCommandOutput, "$metadata">;
export type ScheduleKind = "at" | "rate" | "cron";

/** Every schedule of every group. The list call leaves out the expression, so each schedule needs one more call. */
export async function listSchedules(): Promise<Schedule[]> {
  const out: { Name?: string; GroupName?: string }[] = [];
  let NextToken: string | undefined;
  do {
    const res = await scheduler.send(new ListSchedulesCommand({ NextToken, MaxResults: 100 }));
    out.push(...(res.Schedules ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return Promise.all(out.map((s) => scheduler.send(new GetScheduleCommand({ Name: s.Name, GroupName: s.GroupName }))));
}

export async function listGroups(): Promise<ScheduleGroupSummary[]> {
  const out: ScheduleGroupSummary[] = [];
  let NextToken: string | undefined;
  do {
    const res = await scheduler.send(new ListScheduleGroupsCommand({ NextToken, MaxResults: 100 }));
    out.push(...(res.ScheduleGroups ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out.sort((a, b) => Number(b.Name === "default") - Number(a.Name === "default") || (a.Name ?? "").localeCompare(b.Name ?? ""));
}

/** Splits `rate(5 minutes)` into its kind and the text inside the brackets. */
export function parseExpression(expression = ""): { kind: ScheduleKind; value: string } {
  const m = /^(at|rate|cron)\((.*)\)$/.exec(expression.trim());
  return m ? { kind: m[1] as ScheduleKind, value: m[2] } : { kind: "rate", value: "" };
}

export const KINDS: Record<ScheduleKind, { label: string; field: string; placeholder: string; hint: string; test: RegExp; error: string }> = {
  at: {
    label: "One-time schedule",
    field: "Date and time",
    placeholder: "2030-01-31T09:00:00",
    hint: "Format: yyyy-mm-ddThh:mm:ss, in the time zone below.",
    test: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
    error: "Enter the date and time as yyyy-mm-ddThh:mm:ss, such as 2030-01-31T09:00:00.",
  },
  rate: {
    label: "Recurring schedule: rate",
    field: "Rate",
    placeholder: "5 minutes",
    hint: "A number and a unit: minutes, hours or days.",
    test: /^[1-9]\d* (minute|minutes|hour|hours|day|days)$/,
    error: "Enter a rate such as 5 minutes, 1 hour or 7 days.",
  },
  cron: {
    label: "Recurring schedule: cron",
    field: "Cron expression",
    placeholder: "0 12 * * ? *",
    hint: "Six fields: minutes hours day-of-month month day-of-week year.",
    test: /^\S+ \S+ \S+ \S+ \S+ \S+$/,
    error: "Enter the six fields of a cron expression, such as 0 12 * * ? *.",
  },
};

/** The flexible time windows the AWS console offers, in minutes. 0 means off. */
export const WINDOWS = [0, 1, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440];

export function windowLabel(minutes: number): string {
  if (!minutes) return "Off";
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Time zone names from the browser. UTC comes first. */
export function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? ["America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
  return ["UTC", ...zones.filter((z) => z !== "UTC")];
}
