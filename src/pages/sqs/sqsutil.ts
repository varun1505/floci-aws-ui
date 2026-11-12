import { GetQueueAttributesCommand, ListQueuesCommand } from "@aws-sdk/client-sqs";
import { sqs } from "../../clients/sqs";

export type Queue = { url: string; name: string; fifo: boolean; arn: string; attrs: Record<string, string> };

export const queueHref = (url: string) => `/sqs/queue?url=${encodeURIComponent(url)}`;
export const queueName = (url: string) => url.split("/").pop() ?? url;

export async function getQueue(url: string): Promise<Queue> {
  const attrs = ((await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["All"] }))).Attributes ?? {}) as Record<string, string>;
  const name = queueName(url);
  return { url, name, fifo: name.endsWith(".fifo"), arn: attrs.QueueArn ?? "", attrs };
}

export async function listQueues(): Promise<Queue[]> {
  const urls: string[] = [];
  let NextToken: string | undefined;
  do {
    const res = await sqs.send(new ListQueuesCommand({ NextToken, MaxResults: 1000 }));
    urls.push(...(res.QueueUrls ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return Promise.all(urls.map(getQueue));
}

/** SQS gives times as seconds since 1970, in a string. */
export const epoch = (seconds?: string) => (seconds ? new Date(Number(seconds) * 1000) : undefined);

export function duration(seconds?: string): string {
  const n = Number(seconds ?? 0);
  if (n >= 86400 && n % 86400 === 0) return `${n / 86400} day${n === 86400 ? "" : "s"}`;
  if (n >= 3600 && n % 3600 === 0) return `${n / 3600} hour${n === 3600 ? "" : "s"}`;
  if (n >= 60 && n % 60 === 0) return `${n / 60} minute${n === 60 ? "" : "s"}`;
  return `${n} second${n === 1 ? "" : "s"}`;
}
