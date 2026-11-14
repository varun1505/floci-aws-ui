import { ListStreamsCommand } from "@aws-sdk/client-kinesis";
import { DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { ListStateMachinesCommand } from "@aws-sdk/client-sfn";
import FormField from "@cloudscape-design/components/form-field";
import Select from "@cloudscape-design/components/select";
import { kinesis } from "../../clients/kinesis";
import { logs } from "../../clients/logs";
import { sfn } from "../../clients/sfn";
import { ACCOUNT_ID, getRegion } from "../../config";
import { useLoad } from "../../lib/useLoad";
import { listAllFunctions } from "../lambda/Functions";
import { listTopics } from "../sns/snsutil";
import { listQueues } from "../sqs/sqsutil";
import { listBuses } from "./eventsutil";

type Resource = { arn: string; name: string };
export type TargetKind = "lambda" | "sqs" | "sns" | "states" | "logs" | "events" | "kinesis";

async function all<T>(page: (token?: string) => Promise<{ items: T[]; next?: string }>): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const res = await page(token);
    out.push(...res.items);
    token = res.next;
  } while (token);
  return out;
}

/** The target types this console knows, and how to list the resources of each. */
export const TARGET_KINDS: Record<TargetKind, { label: string; noun: string; needsRole: boolean; load: () => Promise<Resource[]> }> = {
  lambda: { label: "Lambda function", noun: "function", needsRole: false, load: async () => (await listAllFunctions()).map((f) => ({ arn: f.FunctionArn ?? "", name: f.FunctionName ?? "" })) },
  sqs: { label: "SQS queue", noun: "queue", needsRole: false, load: async () => (await listQueues()).map((q) => ({ arn: q.arn, name: q.name })) },
  sns: { label: "SNS topic", noun: "topic", needsRole: false, load: async () => (await listTopics()).map((t) => ({ arn: t.arn, name: t.name })) },
  states: {
    label: "Step Functions state machine",
    noun: "state machine",
    needsRole: true,
    load: async () =>
      (await all(async (nextToken) => sfn.send(new ListStateMachinesCommand({ nextToken })).then((r) => ({ items: r.stateMachines ?? [], next: r.nextToken })))).map((m) => ({ arn: m.stateMachineArn ?? "", name: m.name ?? "" })),
  },
  logs: {
    label: "CloudWatch log group",
    noun: "log group",
    needsRole: false,
    load: async () =>
      (await all(async (nextToken) => logs.send(new DescribeLogGroupsCommand({ nextToken })).then((r) => ({ items: r.logGroups ?? [], next: r.nextToken })))).map((g) => ({
        // Log group ARNs end in ":*". EventBridge wants the ARN without it.
        arn: (g.arn ?? `arn:aws:logs:${getRegion()}:${ACCOUNT_ID}:log-group:${g.logGroupName}`).replace(/:\*$/, ""),
        name: g.logGroupName ?? "",
      })),
  },
  events: { label: "EventBridge event bus", noun: "event bus", needsRole: true, load: async () => (await listBuses()).map((b) => ({ arn: b.Arn ?? "", name: b.Name ?? "" })) },
  kinesis: {
    label: "Kinesis stream",
    noun: "stream",
    needsRole: true,
    load: async () =>
      (await all(async (NextToken) => kinesis.send(new ListStreamsCommand({ NextToken })).then((r) => ({ items: r.StreamSummaries ?? [], next: r.NextToken })))).map((s) => ({ arn: s.StreamARN ?? "", name: s.StreamName ?? "" })),
  },
};

/** Works out the target type from an ARN, for the Type column. */
export function targetKind(arn = ""): string {
  const [, , service, , , resource = ""] = arn.split(":");
  if (service === "lambda") return "Lambda function";
  if (service === "sqs") return "SQS queue";
  if (service === "sns") return "SNS topic";
  if (service === "states") return "Step Functions state machine";
  if (service === "logs") return "CloudWatch log group";
  if (service === "kinesis") return "Kinesis stream";
  if (service === "events" && resource.startsWith("event-bus/")) return "EventBridge event bus";
  if (service === "events" && resource.startsWith("api-destination/")) return "API destination";
  if (service === "ecs") return "ECS task";
  if (service === "scheduler") return "AWS API call";
  return service || "-";
}

/** Two fields: the target type, then the resource of that type. Gives back the ARN of the resource. */
export function TargetPicker({ kinds, kind, arn, onChange }: { kinds: TargetKind[]; kind: TargetKind; arn: string; onChange: (kind: TargetKind, arn: string) => void }) {
  const resources = useLoad(() => TARGET_KINDS[kind].load(), [kind]);
  const noun = TARGET_KINDS[kind].noun;
  const options = (resources.data ?? []).filter((r) => r.arn).map((r) => ({ value: r.arn, label: r.name, description: r.arn }));
  // When editing, the saved target can be a resource that no longer exists. Keep it in the list.
  if (arn && !resources.loading && !options.some((o) => o.value === arn)) options.unshift({ value: arn, label: arn.split(/[:/]/).pop() ?? arn, description: arn });
  return (
    <>
      <FormField label="Target type">
        <Select
          selectedOption={{ value: kind, label: TARGET_KINDS[kind].label }}
          onChange={(e) => onChange(e.detail.selectedOption.value as TargetKind, "")}
          options={kinds.map((value) => ({ value, label: TARGET_KINDS[value].label }))}
          ariaLabel="Target type"
        />
      </FormField>
      <FormField label={noun[0].toUpperCase() + noun.slice(1)}>
        <Select
          selectedOption={options.find((o) => o.value === arn) ?? null}
          onChange={(e) => onChange(kind, e.detail.selectedOption.value ?? "")}
          options={options}
          placeholder={`Choose a ${noun}`}
          statusType={resources.loading ? "loading" : resources.error ? "error" : "finished"}
          loadingText={`Loading ${noun}s`}
          errorText={resources.error}
          empty={`No ${noun}s. Create one first.`}
          filteringType="auto"
          ariaLabel={`Choose a ${noun}`}
        />
      </FormField>
    </>
  );
}

/** Picks the target type that matches a saved ARN, so an edit form opens on the right type. */
export function kindOfArn(arn: string, kinds: TargetKind[]): TargetKind {
  const service = arn.split(":")[2] as TargetKind;
  return kinds.includes(service) ? service : kinds[0];
}
