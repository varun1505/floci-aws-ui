import { type EventBus, ListEventBusesCommand, ListRulesCommand, ListTargetsByRuleCommand, RemoveTargetsCommand, DeleteRuleCommand, type Rule, type Target } from "@aws-sdk/client-eventbridge";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { eventbridge } from "../../clients/eventbridge";

export const DEFAULT_BUS = "default";
export const ruleHref = (name: string, bus = DEFAULT_BUS) => `/events/rule?name=${encodeURIComponent(name)}&bus=${encodeURIComponent(bus)}`;

/** Every event bus, with the default bus first. */
export async function listBuses(): Promise<EventBus[]> {
  const out: EventBus[] = [];
  let NextToken: string | undefined;
  do {
    const res = await eventbridge.send(new ListEventBusesCommand({ NextToken }));
    out.push(...(res.EventBuses ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out.sort((a, b) => Number(b.Name === DEFAULT_BUS) - Number(a.Name === DEFAULT_BUS) || (a.Name ?? "").localeCompare(b.Name ?? ""));
}

export async function listRules(bus: string): Promise<Rule[]> {
  const out: Rule[] = [];
  let NextToken: string | undefined;
  do {
    const res = await eventbridge.send(new ListRulesCommand({ EventBusName: bus, NextToken }));
    out.push(...(res.Rules ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export async function listTargets(rule: string, bus: string): Promise<Target[]> {
  const out: Target[] = [];
  let NextToken: string | undefined;
  do {
    const res = await eventbridge.send(new ListTargetsByRuleCommand({ Rule: rule, EventBusName: bus, NextToken }));
    out.push(...(res.Targets ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

/** EventBridge refuses to delete a rule that still has targets. So this removes the targets first. */
export async function deleteRule(name: string, bus: string) {
  const ids = (await listTargets(name, bus)).map((t) => t.Id ?? "");
  // RemoveTargets takes at most 10 IDs in one call.
  for (let i = 0; i < ids.length; i += 10) await eventbridge.send(new RemoveTargetsCommand({ Rule: name, EventBusName: bus, Ids: ids.slice(i, i + 10) }));
  await eventbridge.send(new DeleteRuleCommand({ Name: name, EventBusName: bus }));
}

export function RuleState({ state }: { state?: string }) {
  if (!state) return <>-</>;
  return state === "DISABLED" ? <StatusIndicator type="stopped">Disabled</StatusIndicator> : <StatusIndicator type="success">Enabled</StatusIndicator>;
}

export const ruleType = (r: { ScheduleExpression?: string }) => (r.ScheduleExpression ? "Scheduled" : "Standard");

/** Empty when the text is a JSON object. Otherwise the message to show in the form. */
export function jsonObjectError(text: string, what: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${what} must be a JSON object.`;
    return "";
  } catch (e) {
    return `${what} is not valid JSON. ${(e as Error).message}`;
  }
}

/** Empty when the text is any JSON value. */
export function jsonError(text: string, what: string): string {
  try {
    JSON.parse(text);
    return "";
  } catch (e) {
    return `${what} is not valid JSON. ${(e as Error).message}`;
  }
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export const SAMPLE_PATTERNS: { value: string; label: string; pattern: string }[] = [
  { value: "custom", label: "Events from my application", pattern: pretty({ source: ["my.app"] }) },
  { value: "detail-type", label: "One detail type from my application", pattern: pretty({ source: ["my.app"], "detail-type": ["OrderPlaced"] }) },
  { value: "detail", label: "Match a field in the detail", pattern: pretty({ source: ["my.app"], detail: { status: ["FAILED", "TIMED_OUT"] } }) },
  { value: "numeric", label: "Match a number range", pattern: pretty({ detail: { amount: [{ numeric: [">=", 100] }] } }) },
  { value: "s3", label: "S3 object created", pattern: pretty({ source: ["aws.s3"], "detail-type": ["Object Created"] }) },
  { value: "all", label: "All events of this account", pattern: pretty({ account: ["000000000000"] }) },
];

export const SAMPLE_EVENT = pretty({
  id: "7bf73129-1428-4cd3-a780-95db273d1602",
  "detail-type": "OrderPlaced",
  source: "my.app",
  account: "000000000000",
  time: "2026-01-01T12:00:00Z",
  region: "us-east-1",
  resources: [],
  detail: { orderId: "123", amount: 250, status: "FAILED" },
});

/** A rate or cron expression of an EventBridge rule, such as `rate(5 minutes)` or `cron(0 12 * * ? *)`. */
export const isScheduleExpression = (text: string) => /^(rate\(\d+ (minute|minutes|hour|hours|day|days)\)|cron\(\S+ \S+ \S+ \S+ \S+ \S+\))$/.test(text.trim());
