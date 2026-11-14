import { DescribeStateMachineCommand, type ExecutionListItem, type ExecutionStatus, ListExecutionsCommand, ListStateMachinesCommand, type StateMachineListItem } from "@aws-sdk/client-sfn";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { sfn } from "../../clients/sfn";

export type MachineRow = StateMachineListItem & { status?: string };

export const machineHref = (arn: string) => `/states/state-machine?arn=${encodeURIComponent(arn)}`;
export const executionHref = (arn: string) => `/states/execution?arn=${encodeURIComponent(arn)}`;
export const typeLabel = (type?: string) => (type === "EXPRESS" ? "Express" : "Standard");

/** Every state machine. The list call leaves out the status, so each machine needs one more call. */
export async function listMachines(): Promise<MachineRow[]> {
  const out: StateMachineListItem[] = [];
  let nextToken: string | undefined;
  do {
    const res = await sfn.send(new ListStateMachinesCommand({ nextToken }));
    out.push(...(res.stateMachines ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return Promise.all(out.map(async (m) => ({ ...m, status: await sfn.send(new DescribeStateMachineCommand({ stateMachineArn: m.stateMachineArn })).then((d) => d.status as string | undefined, () => undefined) })));
}

export async function listExecutions(stateMachineArn: string, statusFilter?: ExecutionStatus): Promise<ExecutionListItem[]> {
  const out: ExecutionListItem[] = [];
  let nextToken: string | undefined;
  do {
    const res = await sfn.send(new ListExecutionsCommand({ stateMachineArn, statusFilter, nextToken }));
    out.push(...(res.executions ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return out.sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0));
}

const STATUS: Record<string, { type: StatusIndicatorProps.Type; label: string }> = {
  RUNNING: { type: "in-progress", label: "Running" },
  SUCCEEDED: { type: "success", label: "Succeeded" },
  FAILED: { type: "error", label: "Failed" },
  TIMED_OUT: { type: "error", label: "Timed out" },
  ABORTED: { type: "stopped", label: "Aborted" },
  PENDING_REDRIVE: { type: "pending", label: "Pending redrive" },
  ACTIVE: { type: "success", label: "Active" },
  DELETING: { type: "in-progress", label: "Deleting" },
};

export const EXECUTION_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "ABORTED"].map((value) => ({ value, label: STATUS[value].label }));

export function Status({ status }: { status?: string }) {
  if (!status) return <>-</>;
  const s = STATUS[status];
  return <StatusIndicator type={s?.type ?? "info"}>{s?.label ?? status}</StatusIndicator>;
}

/** How long an execution took, or has run so far when it has no end. */
export function duration(start?: Date, end?: Date): string {
  if (!start) return "-";
  const ms = Math.max(0, (end ?? new Date()).getTime() - start.getTime());
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.floor(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export const TEMPLATES: { value: string; label: string; definition: string }[] = [
  {
    value: "hello",
    label: "Hello world (Pass state)",
    definition: pretty({ Comment: "A Hello World example", StartAt: "Hello", States: { Hello: { Type: "Pass", Result: { message: "Hello, world!" }, End: true } } }),
  },
  {
    value: "wait-choice",
    label: "Wait, then choose",
    definition: pretty({
      Comment: "Waits, then takes a path that depends on the input",
      StartAt: "Wait 5 seconds",
      States: {
        "Wait 5 seconds": { Type: "Wait", Seconds: 5, Next: "Is it approved?" },
        "Is it approved?": { Type: "Choice", Choices: [{ Variable: "$.approved", BooleanEquals: true, Next: "Approved" }], Default: "Rejected" },
        Approved: { Type: "Succeed" },
        Rejected: { Type: "Fail", Error: "Rejected", Cause: "The input did not have approved set to true." },
      },
    }),
  },
  {
    value: "lambda",
    label: "Run a Lambda function",
    definition: pretty({
      Comment: "Calls a Lambda function. Put the ARN of your function in Resource.",
      StartAt: "Invoke function",
      States: {
        "Invoke function": {
          Type: "Task",
          Resource: "arn:aws:lambda:us-east-1:000000000000:function:my-function",
          Retry: [{ ErrorEquals: ["States.TaskFailed"], IntervalSeconds: 2, MaxAttempts: 2, BackoffRate: 2 }],
          End: true,
        },
      },
    }),
  },
];

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

export type StateRow = { name: string; type: string; next: string; start: boolean };

/** The states of a definition as rows: name, type and where each one goes next. */
export function outline(definition?: string): StateRow[] {
  try {
    const doc = JSON.parse(definition ?? "") as { StartAt?: string; States?: Record<string, { Type?: string; Next?: string; End?: boolean; Default?: string; Choices?: { Next?: string }[]; Catch?: { Next?: string }[] }> };
    return Object.entries(doc.States ?? {}).map(([name, s]) => {
      const next = [s.Next, ...(s.Choices ?? []).map((c) => c.Next), s.Default, ...(s.Catch ?? []).map((c) => c.Next)].filter((n): n is string => !!n);
      const end = s.End || s.Type === "Succeed" || s.Type === "Fail";
      return { name, type: s.Type ?? "-", next: [...new Set(next)].join(", ") || (end ? "End" : "-"), start: name === doc.StartAt };
    });
  } catch {
    return [];
  }
}
