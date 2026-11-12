import { GetRestApisCommand } from "@aws-sdk/client-api-gateway";
import { GetApisCommand } from "@aws-sdk/client-apigatewayv2";
import { apigw } from "../../clients/apigw";
import { apigwv2 } from "../../clients/apigwv2";
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
