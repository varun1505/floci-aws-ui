import { GetRestApisCommand } from "@aws-sdk/client-api-gateway";
import { GetApisCommand } from "@aws-sdk/client-apigatewayv2";
import { apigw } from "../../clients/apigw";
import { apigwv2 } from "../../clients/apigwv2";
import Box from "@cloudscape-design/components/box";
import type { ReactNode } from "react";
import { PROXY_BASE } from "../../config";

export type ApiRow = {
  id: string;
  name: string;
  description?: string;
  protocol: "REST" | "HTTP" | "WEBSOCKET";
  endpointType: string;
  created?: Date;
};

/** REST APIs (v1) and HTTP/WebSocket APIs (v2) in one list, the way the AWS console shows them. */
export async function listApis(): Promise<ApiRow[]> {
  const [rest, v2] = await Promise.all([
    apigw.send(new GetRestApisCommand({ limit: 500 })).then((r) => r.items ?? []),
    apigwv2.send(new GetApisCommand({})).then((r) => r.Items ?? []),
  ]);
  return [
    ...rest.map(
      (a): ApiRow => ({
        id: a.id ?? "",
        name: a.name ?? "",
        description: a.description,
        protocol: "REST",
        endpointType: a.endpointConfiguration?.types?.join(", ") ?? "REGIONAL",
        created: a.createdDate,
      }),
    ),
    ...v2.map(
      (a): ApiRow => ({
        id: a.ApiId ?? "",
        name: a.Name ?? "",
        description: a.Description,
        protocol: (a.ProtocolType ?? "HTTP") as ApiRow["protocol"],
        endpointType: "Regional",
        created: a.CreatedDate,
      }),
    ),
  ].sort((a, b) => (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0));
}

export const apiHref = (api: Pick<ApiRow, "id" | "protocol">) => (api.protocol === "REST" ? `/apigateway/rest/${api.id}` : `/apigateway/http/${api.id}`);

/** Where a deployed stage answers requests in this environment. */
export function invokeUrl(apiId: string, stage: string): string {
  return `${PROXY_BASE}/_aws/execute-api/${apiId}/${stage}`;
}

export const HTTP_METHODS = ["ANY", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** The URI API Gateway uses to call a Lambda function from a REST API. */
export const lambdaUri = (region: string, functionArn: string) => `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`;

/** Pulls the function name back out of an integration URI or ARN, for display. */
export function integrationTarget(uri?: string): string {
  if (!uri) return "-";
  const fn = uri.match(/function:([^/:]+)/);
  return fn ? `Lambda: ${fn[1]}` : uri;
}

export async function listFunctionArns(): Promise<{ label: string; value: string }[]> {
  const { listAllFunctions } = await import("../lambda/Functions");
  return (await listAllFunctions()).map((f) => ({ label: f.FunctionName ?? "", value: f.FunctionArn ?? "" }));
}

export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children || "-"}</div>
    </div>
  );
}
