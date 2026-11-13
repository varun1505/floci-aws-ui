import { describe, expect, it } from "vitest";
import { prettyJson } from "../components/Pair";
import { PROXY_BASE } from "../config";
import { apiHref, integrationTarget, invokeUrl, lambdaUri } from "./apigateway/apiutil";
import { connectCommand as cacheConnect, isSettled as cacheSettled, validCacheId } from "./elasticache/cacheutil";
import { lbHref, tgName, validName } from "./elb/elbutil";
import { isAwsManaged, jsonError, policyHref } from "./iam/iamutil";
import { connectCommand as dbConnect, isSettled as dbSettled } from "./rds/rdsutil";
import { bucketHref, objectHref, prefixCrumbs } from "./s3/s3util";
import { subscriptionId, topicHref, topicName } from "./sns/snsutil";
import { duration, epoch, queueHref, queueName } from "./sqs/sqsutil";

describe("SQS helpers", () => {
  it("takes the queue name from the URL", () => {
    expect(queueName("http://floci:4566/000000000000/orders.fifo")).toBe("orders.fifo");
  });
  it("puts the queue URL in a query parameter", () => {
    expect(queueHref("http://floci:4566/000000000000/orders")).toBe("/sqs/queue?url=http%3A%2F%2Ffloci%3A4566%2F000000000000%2Forders");
  });
  it("reads seconds since 1970", () => {
    expect(epoch("1700000000")?.getTime()).toBe(1700000000000);
    expect(epoch(undefined)).toBeUndefined();
  });
  it("writes a duration in the largest whole unit", () => {
    expect(duration("0")).toBe("0 seconds");
    expect(duration("1")).toBe("1 second");
    expect(duration("30")).toBe("30 seconds");
    expect(duration("60")).toBe("1 minute");
    expect(duration("90")).toBe("90 seconds");
    expect(duration("3600")).toBe("1 hour");
    expect(duration("345600")).toBe("4 days");
    expect(duration(undefined)).toBe("0 seconds");
  });
});

describe("SNS helpers", () => {
  it("takes the topic name from the ARN", () => {
    expect(topicName("arn:aws:sns:us-east-1:000000000000:alerts")).toBe("alerts");
  });
  it("puts the topic ARN in a query parameter", () => {
    expect(topicHref("arn:aws:sns:us-east-1:000000000000:alerts")).toBe("/sns/topic?arn=arn%3Aaws%3Asns%3Aus-east-1%3A000000000000%3Aalerts");
  });
  it("shows the ID of a subscription, or its pending state", () => {
    expect(subscriptionId("arn:aws:sns:us-east-1:000000000000:alerts:1234-abcd")).toBe("1234-abcd");
    expect(subscriptionId("PendingConfirmation")).toBe("PendingConfirmation");
    expect(subscriptionId(undefined)).toBe("-");
  });
});

describe("S3 helpers", () => {
  it("builds bucket and object links", () => {
    expect(bucketHref("my bucket")).toBe("/s3/bucket?name=my%20bucket");
    expect(bucketHref("b", "a/b/")).toBe("/s3/bucket?name=b&prefix=a%2Fb%2F");
    expect(objectHref("b", "a/b.txt")).toBe("/s3/object?bucket=b&key=a%2Fb.txt");
  });
  it("makes one breadcrumb for each folder", () => {
    const crumbs = prefixCrumbs("b", "a/c/");
    expect(crumbs.map((c) => c.text)).toEqual(["Amazon S3", "Buckets", "b", "a/", "c/"]);
    expect(crumbs[4].href).toBe(bucketHref("b", "a/c/"));
  });
  it("makes no folder breadcrumbs at the bucket root", () => {
    expect(prefixCrumbs("b", "")).toHaveLength(3);
  });
});

describe("API Gateway helpers", () => {
  it("links REST and HTTP APIs to different pages", () => {
    expect(apiHref({ id: "abc", protocol: "REST" })).toBe("/apigateway/rest/abc");
    expect(apiHref({ id: "abc", protocol: "HTTP" })).toBe("/apigateway/http/abc");
  });
  it("builds the invoke URL that floci answers on", () => {
    expect(invokeUrl("abc", "prod")).toBe(`${PROXY_BASE}/_aws/execute-api/abc/prod`);
  });
  it("builds a Lambda integration URI and reads the function name back", () => {
    const uri = lambdaUri("us-east-1", "arn:aws:lambda:us-east-1:000000000000:function:hello");
    expect(uri).toBe("arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:hello/invocations");
    expect(integrationTarget(uri)).toBe("Lambda: hello");
  });
  it("shows other integration targets as they are", () => {
    expect(integrationTarget("https://example.com")).toBe("https://example.com");
    expect(integrationTarget(undefined)).toBe("-");
  });
});

describe("ElastiCache helpers", () => {
  it("accepts valid cache names", () => {
    expect(validCacheId("a")).toBe(true);
    expect(validCacheId("my-cache-1")).toBe(true);
  });
  it("rejects invalid cache names", () => {
    expect(validCacheId("")).toBe(false);
    expect(validCacheId("1cache")).toBe(false);
    expect(validCacheId("cache-")).toBe(false);
    expect(validCacheId("my--cache")).toBe(false);
    expect(validCacheId("a".repeat(41))).toBe(false);
  });
  it("picks the client for the engine", () => {
    expect(cacheConnect("valkey", "h", 6379)).toBe("valkey-cli -h h -p 6379");
    expect(cacheConnect("redis", "h", 6379)).toBe("redis-cli -h h -p 6379");
    expect(cacheConnect("memcached", "h", 11211)).toBe("telnet h 11211");
    expect(cacheConnect("redis", undefined, 6379)).toBe("");
  });
  it("knows which states are still changing", () => {
    expect(cacheSettled("available")).toBe(true);
    expect(cacheSettled("creating")).toBe(false);
  });
});

describe("RDS helpers", () => {
  it("builds a psql command", () => {
    expect(dbConnect({ Engine: "postgres", Endpoint: { Port: 7001 }, MasterUsername: "app", DBName: "shop" }, "10.0.0.5")).toBe("psql -h 10.0.0.5 -p 7001 -U app shop");
  });
  it("builds a mysql command with the default port", () => {
    expect(dbConnect({ Engine: "mysql" }, "")).toBe("mysql -h <floci-host> -P 3306 -u admin -p");
  });
  it("knows which states are still changing", () => {
    expect(dbSettled("available")).toBe(true);
    expect(dbSettled("stopped")).toBe(true);
    expect(dbSettled("creating")).toBe(false);
  });
});

describe("load balancer helpers", () => {
  it("accepts valid names", () => {
    expect(validName("web")).toBe(true);
    expect(validName("web-1")).toBe(true);
  });
  it("rejects invalid names", () => {
    expect(validName("")).toBe(false);
    expect(validName("-web")).toBe(false);
    expect(validName("web-")).toBe(false);
    expect(validName("internal-web")).toBe(false);
    expect(validName("a".repeat(33))).toBe(false);
    expect(validName("web_1")).toBe(false);
  });
  it("takes the target group name from the ARN", () => {
    expect(tgName("arn:aws:elasticloadbalancing:us-east-1:000000000000:targetgroup/web/abc123")).toBe("web");
    expect(tgName(undefined)).toBe("-");
  });
  it("puts the ARN in a query parameter", () => {
    expect(lbHref("arn:x/y")).toBe("/ec2/load-balancer?arn=arn%3Ax%2Fy");
  });
});

describe("IAM helpers", () => {
  it("tells AWS managed policies from your own", () => {
    expect(isAwsManaged("arn:aws:iam::aws:policy/AdministratorAccess")).toBe(true);
    expect(isAwsManaged("arn:aws:iam::000000000000:policy/mine")).toBe(false);
    expect(isAwsManaged(undefined)).toBe(false);
  });
  it("puts the policy ARN in a query parameter", () => {
    expect(policyHref("arn:aws:iam::000000000000:policy/mine")).toBe("/iam/policy?arn=arn%3Aaws%3Aiam%3A%3A000000000000%3Apolicy%2Fmine");
  });
  it("reports invalid policy JSON", () => {
    expect(jsonError('{"Version":"2012-10-17"}')).toBe("");
    expect(jsonError("{oops")).toMatch(/^The policy is not valid JSON\./);
  });
});

describe("prettyJson", () => {
  it("indents plain JSON", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
  it("decodes the URL-encoded documents IAM returns", () => {
    expect(prettyJson(encodeURIComponent('{"a":1}'))).toBe('{\n  "a": 1\n}');
  });
  it("gives back text that is not JSON", () => {
    expect(prettyJson("hello")).toBe("hello");
    expect(prettyJson(undefined)).toBe("");
  });
});
