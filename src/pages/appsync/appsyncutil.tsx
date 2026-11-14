import {
  type ApiKey,
  type DataSource,
  GetIntrospectionSchemaCommand,
  type GraphqlApi,
  ListApiKeysCommand,
  ListDataSourcesCommand,
  ListGraphqlApisCommand,
  ListResolversCommand,
  type Resolver,
} from "@aws-sdk/client-appsync";
import { appsync } from "../../clients/appsync";

export async function listApis(): Promise<GraphqlApi[]> {
  const out: GraphqlApi[] = [];
  let nextToken: string | undefined;
  do {
    const res = await appsync.send(new ListGraphqlApisCommand({ nextToken }));
    out.push(...(res.graphqlApis ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return out;
}

export async function listKeys(apiId: string): Promise<ApiKey[]> {
  const out: ApiKey[] = [];
  let nextToken: string | undefined;
  do {
    const res = await appsync.send(new ListApiKeysCommand({ apiId, nextToken }));
    out.push(...(res.apiKeys ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return out;
}

export async function listDataSources(apiId: string): Promise<DataSource[]> {
  const out: DataSource[] = [];
  let nextToken: string | undefined;
  do {
    const res = await appsync.send(new ListDataSourcesCommand({ apiId, nextToken }));
    out.push(...(res.dataSources ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return out;
}

/** The resolvers of the given types. AppSync lists resolvers one type at a time. */
export async function listResolvers(apiId: string, typeNames: string[]): Promise<Resolver[]> {
  const out: Resolver[] = [];
  for (const typeName of typeNames) {
    let nextToken: string | undefined;
    do {
      const res = await appsync.send(new ListResolversCommand({ apiId, typeName, nextToken }));
      out.push(...(res.resolvers ?? []));
      nextToken = res.nextToken;
    } while (nextToken);
  }
  return out;
}

/** The saved schema as SDL text. Empty when the API has no schema yet. */
export async function readSchema(apiId: string): Promise<string> {
  try {
    const res = await appsync.send(new GetIntrospectionSchemaCommand({ apiId, format: "SDL" }));
    const text = new TextDecoder().decode(res.schema);
    // AWS returns the SDL itself. floci wraps it in a JSON object.
    try {
      const wrapped = JSON.parse(text) as { schema?: { definition?: string } };
      if (typeof wrapped?.schema?.definition === "string") return wrapped.schema.definition;
    } catch {
      /* not JSON, so it is the SDL */
    }
    return text;
  } catch (e) {
    if ((e as { name?: string }).name === "NotFoundException") return "";
    throw e;
  }
}

export type SchemaField = { type: string; field: string; returns: string };

/** The object types of a schema and their fields. A small reader, enough to pick a field for a resolver. */
export function parseTypes(sdl: string): SchemaField[] {
  const text = sdl.replace(/"""[\s\S]*?"""/g, "").replace(/#[^\n]*/g, "");
  const out: SchemaField[] = [];
  const block = /(?:^|\s)(?:extend\s+)?type\s+(\w+)[^{]*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = block.exec(text))) {
    const field = /(\w+)\s*(?:\([^)]*\))?\s*:\s*([[\]\w!]+)/g;
    let f: RegExpExecArray | null;
    while ((f = field.exec(m[2]))) out.push({ type: m[1], field: f[1], returns: f[2] });
  }
  return out;
}

export const typeNames = (fields: SchemaField[]) => [...new Set(fields.map((f) => f.type))];

export const AUTH_LABEL: Record<string, string> = {
  API_KEY: "API key",
  AWS_IAM: "AWS Identity and Access Management (IAM)",
  AMAZON_COGNITO_USER_POOLS: "Amazon Cognito user pool",
  AWS_LAMBDA: "AWS Lambda",
  OPENID_CONNECT: "OpenID Connect",
};

export const authLabel = (type?: string) => (type ? (AUTH_LABEL[type] ?? type) : "-");

/** True when callers can use an API key, as the main auth mode or an extra one. */
export const usesApiKey = (api?: GraphqlApi) => api?.authenticationType === "API_KEY" || !!api?.additionalAuthenticationProviders?.some((p) => p.authenticationType === "API_KEY");

/** API key times are in seconds. */
export const keyDate = (seconds?: number) => (seconds ? new Date(seconds * 1000) : undefined);

export const SOURCE_LABEL: Record<string, string> = {
  NONE: "None",
  AWS_LAMBDA: "AWS Lambda function",
  AMAZON_DYNAMODB: "Amazon DynamoDB table",
  HTTP: "HTTP endpoint",
  RELATIONAL_DATABASE: "Relational database",
  AMAZON_EVENTBRIDGE: "Amazon EventBridge",
  AMAZON_OPENSEARCH_SERVICE: "Amazon OpenSearch Service",
  AMAZON_BEDROCK_RUNTIME: "Amazon Bedrock",
};

/** What a data source points at: a table, a function or a URL. */
export function sourceResource(d: DataSource): string {
  return d.dynamodbConfig?.tableName ?? d.lambdaConfig?.lambdaFunctionArn ?? d.httpConfig?.endpoint ?? d.relationalDatabaseConfig?.rdsHttpEndpointConfig?.dbClusterIdentifier ?? "";
}

export const SCHEMA_TEMPLATE = `type Query {
  hello(name: String): String
}

schema {
  query: Query
}
`;

export const JS_TEMPLATE = `/**
 * Sends a request to the data source.
 * With a None data source, the payload goes straight to the response.
 */
export function request(ctx) {
  return { payload: ctx.args };
}

/**
 * Returns the result of the resolver.
 */
export function response(ctx) {
  return ctx.result;
}
`;

export const VTL_REQUEST_TEMPLATE = `{
  "version": "2018-05-29",
  "payload": $util.toJson($ctx.args)
}
`;

export const VTL_RESPONSE_TEMPLATE = "$util.toJson($ctx.result)\n";

/** Reads the error list that a failed schema save returns. Gives one line per problem. */
export function schemaErrors(details?: string): string[] {
  if (!details) return ["The schema is not valid."];
  try {
    const parsed = JSON.parse(details) as { detail?: { codeErrors?: { value?: string }[] } };
    const lines = (parsed.detail?.codeErrors ?? []).map((e) => e.value ?? "").filter(Boolean);
    return lines.length ? lines : [details];
  } catch {
    return [details];
  }
}
