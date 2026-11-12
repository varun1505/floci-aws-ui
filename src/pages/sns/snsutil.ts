import { ListSubscriptionsCommand, ListTopicsCommand, type Subscription } from "@aws-sdk/client-sns";
import { sns } from "../../clients/sns";

export const topicHref = (arn: string) => `/sns/topic?arn=${encodeURIComponent(arn)}`;
export const topicName = (arn: string) => arn.split(":").pop() ?? arn;
export const subscriptionId = (arn?: string) => (arn?.startsWith("arn:") ? (arn.split(":").pop() ?? arn) : (arn ?? "-"));

export async function listTopics(): Promise<{ arn: string; name: string; fifo: boolean }[]> {
  const out: string[] = [];
  let NextToken: string | undefined;
  do {
    const res = await sns.send(new ListTopicsCommand({ NextToken }));
    out.push(...(res.Topics ?? []).map((t) => t.TopicArn ?? ""));
    NextToken = res.NextToken;
  } while (NextToken);
  return out.map((arn) => ({ arn, name: topicName(arn), fifo: arn.endsWith(".fifo") }));
}

export async function listSubscriptions(): Promise<Subscription[]> {
  const out: Subscription[] = [];
  let NextToken: string | undefined;
  do {
    const res = await sns.send(new ListSubscriptionsCommand({ NextToken }));
    out.push(...(res.Subscriptions ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export const PROTOCOLS = [
  { value: "sqs", label: "Amazon SQS" },
  { value: "lambda", label: "AWS Lambda" },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
];
