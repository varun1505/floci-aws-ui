import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3 } from "../../clients/s3";

/** Every object key under a prefix. An empty prefix means the whole bucket. */
export async function listAllKeys(bucket: string, prefix = ""): Promise<string[]> {
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken }));
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

export async function deleteKeys(bucket: string, keys: string[]) {
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(keys.slice(i, i + 20).map((Key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }))));
  }
}

export const bucketHref = (bucket: string, prefix = "") =>
  `/s3/bucket?name=${encodeURIComponent(bucket)}${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ""}`;

export const objectHref = (bucket: string, key: string) => `/s3/object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;

/** Breadcrumbs for a bucket and each folder of a prefix. */
export function prefixCrumbs(bucket: string, prefix: string) {
  const crumbs = [
    { text: "Amazon S3", href: "/s3/buckets" },
    { text: "Buckets", href: "/s3/buckets" },
    { text: bucket, href: bucketHref(bucket) },
  ];
  const parts = prefix.split("/").filter(Boolean);
  parts.forEach((part, i) => crumbs.push({ text: `${part}/`, href: bucketHref(bucket, parts.slice(0, i + 1).join("/") + "/") }));
  return crumbs;
}
