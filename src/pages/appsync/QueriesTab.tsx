import { useEffect, useState } from "react";
import type { GraphqlApi } from "@aws-sdk/client-appsync";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { Code } from "../../components/Code";
import { PROXY_BASE } from "../../config";
import { errorMessage } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { authLabel, listKeys, usesApiKey } from "./appsyncutil";

const EXAMPLE = `query {
  __typename
}
`;

/** Sends a GraphQL request to floci, through the console's own /aws route, and returns the answer as text. */
export async function runQuery(apiId: string, apiKey: string, query: string, variables: unknown): Promise<string> {
  const res = await fetch(`${PROXY_BASE}/v1/apis/${apiId}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.text();
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body || `HTTP ${res.status}`;
  }
}

/** A small query box. It runs a GraphQL query or mutation against the API with an API key. */
export function QueriesTab({ api }: { api: GraphqlApi }) {
  const apiId = api.apiId ?? "";
  const keys = useLoad(() => listKeys(apiId), [apiId]);
  const [key, setKey] = useState("");
  const [query, setQuery] = useState(EXAMPLE);
  const [variables, setVariables] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  // Pick the first key once the list has loaded.
  useEffect(() => {
    if (!key && keys.data?.length) setKey(keys.data[0].id ?? "");
  }, [key, keys.data]);

  if (!usesApiKey(api))
    return (
      <Alert type="info" header="The query box needs an API key">
        This API uses {authLabel(api.authenticationType)}. The query box can only sign in with an API key. Send requests from your own client to the GraphQL endpoint instead.
      </Alert>
    );

  const run = async () => {
    let vars: unknown;
    try {
      vars = variables.trim() ? JSON.parse(variables) : {};
    } catch {
      return setError("The variables are not valid JSON.");
    }
    if (!query.trim()) return setError("Enter a query.");
    if (!key) return setError("Choose an API key. Create one in the Settings tab if the list is empty.");
    setBusy(true);
    setError("");
    try {
      setResult(await runQuery(apiId, key, query, vars));
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Runs against floci with the chosen API key. The first query can fail with a timeout while floci starts its resolver container. Run it again."
          actions={
            <Button variant="primary" loading={busy} onClick={run}>
              Run
            </Button>
          }
        >
          Queries
        </Header>
      }
    >
      <SpaceBetween size="l">
        <FormField label="API key">
          <Select
            selectedOption={key ? { value: key, label: key } : null}
            onChange={(e) => setKey(e.detail.selectedOption.value ?? "")}
            options={(keys.data ?? []).map((k) => ({ value: k.id ?? "", label: k.id ?? "", description: k.description }))}
            placeholder="Choose an API key"
            statusType={keys.loading ? "loading" : "finished"}
            empty="No API keys. Create one in the Settings tab."
          />
        </FormField>
        <ColumnLayout columns={2}>
          <FormField label="Query" stretch>
            <Code value={query} onChange={setQuery} language="text" height={260} ariaLabel="Query" />
          </FormField>
          <FormField label="Response" stretch>
            <pre style={{ margin: 0, height: 300, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 13 }}>{result || "Run a query to see the response."}</pre>
          </FormField>
        </ColumnLayout>
        <FormField label="Query variables" description="A JSON object." stretch>
          <Code value={variables} onChange={setVariables} language="json" height={100} ariaLabel="Query variables" />
        </FormField>
        {error && <Alert type="error">{error}</Alert>}
      </SpaceBetween>
    </Container>
  );
}
