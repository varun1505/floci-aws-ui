import { DescribeStackEventsCommand, ListStackResourcesCommand, ListStacksCommand, type StackEvent, type StackResourceSummary, type StackSummary } from "@aws-sdk/client-cloudformation";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { cloudformation } from "../../clients/cloudformation";

export const CFN_CRUMBS = [
  { text: "CloudFormation", href: "/cloudformation/stacks" },
  { text: "Stacks", href: "/cloudformation/stacks" },
];

/** Every stack, newest first. This includes stacks that were deleted a short while ago. */
export async function listStacks(): Promise<StackSummary[]> {
  const out: StackSummary[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cloudformation.send(new ListStacksCommand({ NextToken }));
    out.push(...(res.StackSummaries ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out.sort((a, b) => (b.CreationTime?.getTime() ?? 0) - (a.CreationTime?.getTime() ?? 0));
}

/** Every event of a stack, newest first. */
export async function listEvents(StackName: string): Promise<StackEvent[]> {
  const out: StackEvent[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cloudformation.send(new DescribeStackEventsCommand({ StackName, NextToken }));
    out.push(...(res.StackEvents ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out.sort((a, b) => (b.Timestamp?.getTime() ?? 0) - (a.Timestamp?.getTime() ?? 0));
}

export async function listResources(StackName: string): Promise<StackResourceSummary[]> {
  const out: StackResourceSummary[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cloudformation.send(new ListStackResourcesCommand({ StackName, NextToken }));
    out.push(...(res.StackResourceSummaries ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export const inProgress = (status?: string) => !!status?.endsWith("_IN_PROGRESS");
export const isDeleted = (status?: string) => status === "DELETE_COMPLETE";

/** The stack status groups of the filter on the stack list, as in the AWS console. */
export const STATUS_FILTERS: { value: string; label: string; match: (status: string) => boolean }[] = [
  { value: "active", label: "Active", match: (s) => !isDeleted(s) },
  { value: "complete", label: "Completed", match: (s) => s.endsWith("_COMPLETE") && !isDeleted(s) },
  { value: "failed", label: "Failed", match: (s) => s.endsWith("_FAILED") },
  { value: "deleted", label: "Deleted", match: isDeleted },
  { value: "progress", label: "In progress", match: inProgress },
];

/** A stack or resource status with the colour the AWS console gives it. */
export function StackStatus({ status }: { status?: string }) {
  if (!status) return <>-</>;
  const rollback = status.includes("ROLLBACK");
  let type: StatusIndicatorProps.Type = "info";
  if (status.endsWith("_FAILED")) type = "error";
  else if (inProgress(status)) type = "in-progress";
  // A rollback that finished still means the create failed. An update rollback leaves a working stack.
  else if (status === "ROLLBACK_COMPLETE") type = "error";
  else if (status === "UPDATE_ROLLBACK_COMPLETE") type = "warning";
  else if (status.endsWith("_COMPLETE")) type = "success";
  else if (status.endsWith("_SKIPPED")) type = "stopped";
  return (
    <StatusIndicator type={type} colorOverride={rollback && inProgress(status) ? "red" : undefined}>
      {status}
    </StatusIndicator>
  );
}

/** The link to a stack page. A deleted stack answers only to its ID, so it is linked by ID. */
export const stackHref = (stack: { StackName?: string; StackId?: string; StackStatus?: string }) =>
  `/cloudformation/stack?name=${encodeURIComponent(isDeleted(stack.StackStatus) ? (stack.StackId ?? "") : (stack.StackName ?? ""))}`;

const q = encodeURIComponent;
const lastPart = (id: string) => id.split(/[:/]/).pop() ?? id;

// Resource types that have a page in this console. Each gives the page of a physical ID.
const RESOURCE_PAGES: Record<string, (id: string) => string> = {
  "AWS::S3::Bucket": (id) => `/s3/bucket?name=${q(id)}`,
  "AWS::SQS::Queue": (id) => `/sqs/queue?url=${q(id)}`,
  "AWS::SNS::Topic": (id) => `/sns/topic?arn=${q(id)}`,
  "AWS::Lambda::Function": (id) => `/lambda/functions/${q(lastPart(id))}`,
  "AWS::DynamoDB::Table": (id) => `/dynamodb/table?name=${q(lastPart(id))}`,
  "AWS::IAM::Role": (id) => `/iam/roles/${q(lastPart(id))}`,
  "AWS::IAM::User": (id) => `/iam/users/${q(lastPart(id))}`,
  "AWS::SSM::Parameter": (id) => `/ssm/parameter?name=${q(id)}`,
  "AWS::KMS::Key": (id) => `/kms/keys/${q(lastPart(id))}`,
  "AWS::Logs::LogGroup": (id) => `/cloudwatch/log-group?name=${q(id)}`,
  "AWS::Kinesis::Stream": (id) => `/kinesis/streams/${q(lastPart(id))}`,
  "AWS::StepFunctions::StateMachine": (id) => `/states/state-machine?arn=${q(id)}`,
  "AWS::EC2::VPC": (id) => `/vpc/vpcs/${q(id)}`,
  "AWS::EC2::SecurityGroup": (id) => `/ec2/security-groups/${q(id)}`,
  "AWS::EC2::Instance": (id) => `/ec2/instances/${q(id)}`,
  "AWS::CloudFormation::Stack": (id) => `/cloudformation/stack?name=${q(id)}`,
};

/** The console page of a stack resource, when this console has one for its type. */
export function resourceHref(type?: string, physicalId?: string): string | undefined {
  if (!type || !physicalId) return undefined;
  return RESOURCE_PAGES[type]?.(physicalId);
}

export const CAPABILITIES = [
  { value: "CAPABILITY_IAM", label: "CAPABILITY_IAM", description: "The template creates IAM resources." },
  { value: "CAPABILITY_NAMED_IAM", label: "CAPABILITY_NAMED_IAM", description: "The template creates IAM resources with custom names." },
  { value: "CAPABILITY_AUTO_EXPAND", label: "CAPABILITY_AUTO_EXPAND", description: "The template has macros or nested stacks." },
];

export const isJson = (template: string) => template.trimStart().startsWith("{");

/** Checks a stack name the way AWS does. Gives the error text, or "" when it is fine. */
export function stackNameError(name: string): string {
  if (!name) return "Enter a stack name.";
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(name)) return "A stack name starts with a letter and has only letters, numbers and hyphens. Up to 128 characters.";
  return "";
}
