import { useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Textarea from "@cloudscape-design/components/textarea";
import { errorMessage } from "../../lib/format";
import { HTTP_METHODS, invokeUrl } from "./apiutil";

export type IntegrationDraft = { kind: "lambda" | "http" | "mock"; fn: string; url: string; mockBody: string };

export const emptyIntegration = (): IntegrationDraft => ({ kind: "lambda", fn: "", url: "", mockBody: '{\n  "message": "ok"\n}' });

export function integrationError(d: IntegrationDraft): string {
  if (d.kind === "lambda" && !d.fn) return "Choose a Lambda function.";
  if (d.kind === "http" && !/^https?:\/\/\S+$/.test(d.url)) return "Enter a URL that starts with http:// or https://.";
  return "";
}

/** The "what does this method call" part of the create method and create route forms. */
export function IntegrationFields({
  draft,
  onChange,
  functions,
  functionsLoading,
  allowMock,
  errorText,
}: {
  draft: IntegrationDraft;
  onChange: (d: IntegrationDraft) => void;
  functions: { label: string; value: string }[];
  functionsLoading: boolean;
  allowMock?: boolean;
  errorText?: string;
}) {
  return (
    <SpaceBetween size="l">
      <FormField label="Integration type">
        <RadioGroup
          value={draft.kind}
          onChange={(e) => onChange({ ...draft, kind: e.detail.value as IntegrationDraft["kind"] })}
          items={[
            { value: "lambda", label: "Lambda function", description: "Send the request to a Lambda function (proxy integration)." },
            { value: "http", label: "HTTP", description: "Forward the request to an HTTP endpoint." },
            ...(allowMock ? [{ value: "mock", label: "Mock", description: "Return a fixed response without calling a backend." }] : []),
          ]}
        />
      </FormField>
      {draft.kind === "lambda" && (
        <FormField label="Lambda function" errorText={errorText}>
          <Select
            selectedOption={functions.find((f) => f.value === draft.fn) ?? null}
            onChange={(e) => onChange({ ...draft, fn: e.detail.selectedOption.value ?? "" })}
            options={functions}
            placeholder="Choose a function"
            filteringType="auto"
            statusType={functionsLoading ? "loading" : "finished"}
            empty="No functions in this Region"
          />
        </FormField>
      )}
      {draft.kind === "http" && (
        <FormField label="Endpoint URL" errorText={errorText}>
          <Input value={draft.url} placeholder="http://my-service:8080/path" onChange={(e) => onChange({ ...draft, url: e.detail.value })} />
        </FormField>
      )}
      {draft.kind === "mock" && (
        <FormField label="Response body" description="Returned with status 200 and content type application/json.">
          <Textarea value={draft.mockBody} rows={5} onChange={(e) => onChange({ ...draft, mockBody: e.detail.value })} spellcheck={false} />
        </FormField>
      )}
    </SpaceBetween>
  );
}

/** Sends a real request to a deployed stage and shows what came back. */
export function TestInvoke({ apiId, stages }: { apiId: string; stages: string[] }) {
  const [stage, setStage] = useState<string | undefined>(undefined);
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: number; ms: number; body: string } | undefined>(undefined);
  const [error, setError] = useState("");

  const current = stage && stages.includes(stage) ? stage : stages[0];
  const hasBody = !["GET", "HEAD"].includes(method);

  const send = async () => {
    if (!current) return;
    setBusy(true);
    setError("");
    setResult(undefined);
    const started = performance.now();
    try {
      const res = await fetch(`${invokeUrl(apiId, current)}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        body: hasBody && body ? body : undefined,
        headers: hasBody && body ? { "content-type": "application/json" } : undefined,
      });
      let text = await res.text();
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON. Show it as it came.
      }
      setResult({ status: res.status, ms: Math.round(performance.now() - started), body: text });
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Container header={<Header variant="h2" description="Send a request to a deployed stage.">Test</Header>}>
      {stages.length === 0 ? (
        <Box color="text-status-inactive">Deploy the API to a stage before you test it.</Box>
      ) : (
        <SpaceBetween size="l">
          <ColumnLayout columns={3}>
            <FormField label="Stage">
              <Select selectedOption={{ value: current, label: current }} onChange={(e) => setStage(e.detail.selectedOption.value)} options={stages.map((s) => ({ value: s, label: s }))} />
            </FormField>
            <FormField label="Method">
              <Select
                selectedOption={{ value: method, label: method }}
                onChange={(e) => setMethod(e.detail.selectedOption.value ?? "GET")}
                options={HTTP_METHODS.filter((m) => m !== "ANY").map((m) => ({ value: m, label: m }))}
              />
            </FormField>
            <FormField label="Path">
              <Input value={path} placeholder="/hello" onChange={(e) => setPath(e.detail.value)} />
            </FormField>
          </ColumnLayout>
          {hasBody && (
            <FormField label="Request body - optional">
              <Textarea value={body} rows={4} onChange={(e) => setBody(e.detail.value)} spellcheck={false} />
            </FormField>
          )}
          <Button loading={busy} onClick={send}>
            Send request
          </Button>
          {error && <StatusIndicator type="error">{error}</StatusIndicator>}
          {result && (
            <SpaceBetween size="xs">
              <StatusIndicator type={result.status < 400 ? "success" : "error"}>
                Status {result.status}, {result.ms} ms
              </StatusIndicator>
              <pre style={{ margin: 0, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 13 }}>{result.body || "(empty response body)"}</pre>
            </SpaceBetween>
          )}
        </SpaceBetween>
      )}
    </Container>
  );
}
