import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DeleteFunctionCommand,
  GetFunctionCommand,
  InvokeCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  type FunctionConfiguration,
  type Runtime,
} from "@aws-sdk/client-lambda";
import { FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import Alert from "@cloudscape-design/components/alert";
import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { lambda, logs, viaProxy } from "../../aws";
import { Code, languageFor } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { LogEvents } from "../../components/LogEvents";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { errorMessage, formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { RUNTIMES } from "./runtimes";

const MAX_INLINE_ZIP = 3 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div>{children}</div>
    </div>
  );
}

function logGroupOf(cfg: FunctionConfiguration): string {
  return cfg.LoggingConfig?.LogGroup ?? `/aws/lambda/${cfg.FunctionName}`;
}

// ---------------------------------------------------------------- Code tab

type Files = Record<string, Uint8Array>;

function isText(data: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

function CodeTab({ cfg, codeUrl, onDeployed }: { cfg: FunctionConfiguration; codeUrl?: string; onDeployed: () => void }) {
  const notify = useNotify();
  const [files, setFiles] = useState<Files | undefined>(undefined);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [active, setActive] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [upload, setUpload] = useState<File[]>([]);

  useEffect(() => {
    let cancelled = false;
    setFiles(undefined);
    setEdits({});
    setNote("");
    (async () => {
      if (!codeUrl) return setNote("The code for this function is not available to view.");
      if ((cfg.CodeSize ?? 0) > MAX_INLINE_ZIP)
        return setNote("The deployment package of your Lambda function is too large to enable inline code editing. However, you can still invoke your function.");
      try {
        const res = await fetch(viaProxy(codeUrl));
        if (!res.ok) throw new Error(`Code download returned ${res.status}`);
        const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
        if (cancelled) return;
        const names = Object.keys(unzipped).filter((n) => !n.endsWith("/")).sort();
        setFiles(unzipped);
        const handlerFile = (cfg.Handler ?? "").split(".")[0];
        setActive(names.find((n) => n.split(".")[0] === handlerFile) ?? names.find((n) => isText(unzipped[n])) ?? names[0] ?? "");
      } catch (e) {
        if (!cancelled) setNote(`Could not load the function code. ${errorMessage(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codeUrl, cfg.CodeSha256]);

  const names = useMemo(() => (files ? Object.keys(files).filter((n) => !n.endsWith("/")).sort() : []), [files]);
  const dirty = Object.keys(edits).length > 0;
  const activeIsText = files && active ? isText(files[active]) : false;
  const value = active in edits ? edits[active] : files && active && activeIsText ? strFromU8(files[active]) : "";

  const pushCode = async (ZipFile: Uint8Array) => {
    setBusy(true);
    try {
      await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: cfg.FunctionName, ZipFile }));
      notify.success(`Successfully updated the function ${cfg.FunctionName}.`);
      setEdits({});
      setUploadOpen(false);
      setUpload([]);
      onDeployed();
    } catch (e) {
      notify.error("Could not update the function code", e);
    }
    setBusy(false);
  };

  const deploy = () => {
    if (!files) return;
    const next: Files = { ...files };
    for (const [name, text] of Object.entries(edits)) next[name] = strToU8(text);
    return pushCode(zipSync(next));
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={dirty ? <StatusIndicator type="warning">You have undeployed changes.</StatusIndicator> : undefined}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setUploadOpen(true)}>Upload from .zip file</Button>
              <Button variant="primary" disabled={!dirty} loading={busy} onClick={deploy}>
                Deploy
              </Button>
            </SpaceBetween>
          }
        >
          Code source
        </Header>
      }
    >
      {note ? (
        <Alert type="info">{note}</Alert>
      ) : !files ? (
        <Box textAlign="center" padding="l">
          <Spinner /> Loading code
        </Box>
      ) : (
        <SpaceBetween size="s">
          <FormField label="File">
            <Select
              selectedOption={{ value: active, label: active + (active in edits ? " •" : "") }}
              options={names.map((n) => ({ value: n, label: n + (n in edits ? " •" : ""), description: formatBytes(files[n].length) }))}
              onChange={(e) => setActive(e.detail.selectedOption.value ?? "")}
              filteringType={names.length > 8 ? "auto" : "none"}
            />
          </FormField>
          {activeIsText ? (
            <Code
              key={active}
              value={value}
              language={languageFor(active)}
              height={420}
              onChange={(v) => {
                if (!files) return;
                setEdits((cur) => {
                  const next = { ...cur };
                  if (v === strFromU8(files[active])) delete next[active];
                  else next[active] = v;
                  return next;
                });
              }}
            />
          ) : (
            <Alert type="info">This file is binary and cannot be edited here.</Alert>
          )}
        </SpaceBetween>
      )}
      <Modal
        visible={uploadOpen}
        onDismiss={() => setUploadOpen(false)}
        header="Upload a .zip file"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={upload.length === 0}
                loading={busy}
                onClick={async () => pushCode(new Uint8Array(await upload[0].arrayBuffer()))}
              >
                Save
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FileUpload
          value={upload}
          onChange={(e) => setUpload(e.detail.value)}
          accept=".zip,.jar"
          showFileSize
          i18nStrings={{
            uploadButtonText: () => "Upload",
            dropzoneText: () => "Drop file to upload",
            removeFileAriaLabel: (i) => `Remove file ${i + 1}`,
            limitShowFewer: "Show fewer files",
            limitShowMore: "Show more files",
            errorIconAriaLabel: "Error",
          }}
        />
      </Modal>
    </Container>
  );
}

// ---------------------------------------------------------------- Test tab

type TestResult = {
  ok: boolean;
  status?: number;
  functionError?: string;
  payload: string;
  durationMs: number;
  logLines: string[];
};

const DEFAULT_EVENT = JSON.stringify({ key1: "value1", key2: "value2", key3: "value3" }, null, 2);

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function TestTab({ cfg }: { cfg: FunctionConfiguration }) {
  const storageKey = `lambda-test-event:${cfg.FunctionName}`;
  const [event, setEvent] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? DEFAULT_EVENT;
    } catch {
      return DEFAULT_EVENT;
    }
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | undefined>(undefined);
  const [invalid, setInvalid] = useState("");

  const run = async () => {
    try {
      JSON.parse(event);
    } catch (e) {
      return setInvalid(`The event is not valid JSON. ${errorMessage(e)}`);
    }
    setInvalid("");
    setBusy(true);
    setResult(undefined);
    try {
      localStorage.setItem(storageKey, event);
    } catch {
      /* ignore */
    }
    const started = Date.now();
    try {
      const res = await lambda.send(new InvokeCommand({ FunctionName: cfg.FunctionName, Payload: strToU8(event) }));
      const durationMs = Date.now() - started;
      // The emulator does not return the log tail with the response. Read it from CloudWatch Logs.
      let logLines: string[] = [];
      for (let attempt = 0; attempt < 4 && logLines.length === 0; attempt++) {
        await sleep(attempt === 0 ? 300 : 800);
        try {
          const out = await logs.send(new FilterLogEventsCommand({ logGroupName: logGroupOf(cfg), startTime: started - 1000 }));
          logLines = (out.events ?? []).map((e) => (e.message ?? "").trimEnd());
        } catch {
          break;
        }
      }
      setResult({
        ok: !res.FunctionError,
        status: res.StatusCode,
        functionError: res.FunctionError,
        payload: res.Payload ? pretty(new TextDecoder().decode(res.Payload)) : "",
        durationMs,
        logLines,
      });
    } catch (e) {
      setResult({ ok: false, payload: errorMessage(e), durationMs: Date.now() - started, logLines: [] });
    }
    setBusy(false);
  };

  return (
    <SpaceBetween size="l">
      {result && (
        <Alert type={result.ok ? "success" : "error"} header={`Executing function: ${result.ok ? "succeeded" : "failed"}`}>
          <ExpandableSection headerText="Details" defaultExpanded>
            <SpaceBetween size="m">
              <div>
                <Box variant="awsui-key-label">Response</Box>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{result.payload || "null"}</pre>
              </div>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Status code">{result.status ?? "-"}</Pair>
                <Pair label="Function error">{result.functionError ?? "-"}</Pair>
                <Pair label="Round-trip duration">{result.durationMs} ms</Pair>
              </ColumnLayout>
              <div>
                <Box variant="awsui-key-label">Log output</Box>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {result.logLines.length ? result.logLines.join("\n") : "The function wrote no log lines."}
                </pre>
              </div>
            </SpaceBetween>
          </ExpandableSection>
        </Alert>
      )}
      <Container
        header={
          <Header
            variant="h2"
            description="Invoke your function with a test event."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setEvent(pretty(event))}>Format JSON</Button>
                <Button variant="primary" loading={busy} onClick={run}>
                  Test
                </Button>
              </SpaceBetween>
            }
          >
            Test event
          </Header>
        }
      >
        <FormField label="Event JSON" errorText={invalid} stretch>
          <Code value={event} onChange={setEvent} language="json" height={240} ariaLabel="Event JSON" />
        </FormField>
      </Container>
    </SpaceBetween>
  );
}

// ---------------------------------------------------------------- Configuration tab

function ConfigurationTab({ cfg, onSaved }: { cfg: FunctionConfiguration; onSaved: () => void }) {
  const notify = useNotify();
  const [editGeneral, setEditGeneral] = useState(false);
  const [editEnv, setEditEnv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [memory, setMemory] = useState("128");
  const [timeout, setTimeoutValue] = useState("3");
  const [handler, setHandler] = useState("");
  const [runtime, setRuntime] = useState("");
  const [env, setEnv] = useState<{ key: string; value: string }[]>([]);

  const vars = Object.entries(cfg.Environment?.Variables ?? {});

  const openGeneral = () => {
    setDescription(cfg.Description ?? "");
    setMemory(String(cfg.MemorySize ?? 128));
    setTimeoutValue(String(cfg.Timeout ?? 3));
    setHandler(cfg.Handler ?? "");
    setRuntime(cfg.Runtime ?? "");
    setEditGeneral(true);
  };

  const save = async (input: Omit<ConstructorParameters<typeof UpdateFunctionConfigurationCommand>[0], "FunctionName">) => {
    setBusy(true);
    try {
      await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: cfg.FunctionName, ...input }));
      notify.success(`Successfully updated the function ${cfg.FunctionName}.`);
      setEditGeneral(false);
      setEditEnv(false);
      onSaved();
    } catch (e) {
      notify.error("Could not update the configuration", e);
    }
    setBusy(false);
  };

  const footer = (onSave: () => void, onCancel: () => void) => (
    <Box float="right">
      <SpaceBetween direction="horizontal" size="xs">
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={onSave}>
          Save
        </Button>
      </SpaceBetween>
    </Box>
  );

  const runtimeOptions = RUNTIMES.some((r) => r.value === runtime) || !runtime ? RUNTIMES : [{ value: runtime, label: runtime }, ...RUNTIMES];

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" actions={<Button onClick={openGeneral}>Edit</Button>}>General configuration</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <Pair label="Description">{cfg.Description || "-"}</Pair>
          <Pair label="Memory">{cfg.MemorySize} MB</Pair>
          <Pair label="Ephemeral storage">{cfg.EphemeralStorage?.Size ?? 512} MB</Pair>
          <Pair label="Timeout">
            {Math.floor((cfg.Timeout ?? 0) / 60)} min {(cfg.Timeout ?? 0) % 60} sec
          </Pair>
          <Pair label="Runtime">{cfg.Runtime ?? "-"}</Pair>
          <Pair label="Handler">{cfg.Handler ?? "-"}</Pair>
          <Pair label="Architecture">{cfg.Architectures?.join(", ") ?? "-"}</Pair>
          <Pair label="Execution role">{cfg.Role ?? "-"}</Pair>
          <Pair label="Package type">{cfg.PackageType ?? "Zip"}</Pair>
        </ColumnLayout>
      </Container>

      <Table
        header={
          <Header
            variant="h2"
            counter={`(${vars.length})`}
            actions={
              <Button
                onClick={() => {
                  setEnv(vars.map(([key, value]) => ({ key, value })));
                  setEditEnv(true);
                }}
              >
                Edit
              </Button>
            }
          >
            Environment variables
          </Header>
        }
        items={vars}
        columnDefinitions={[
          { id: "key", header: "Key", cell: (v) => v[0], isRowHeader: true },
          { id: "value", header: "Value", cell: (v) => v[1] },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            <b>No environment variables</b>
            <Box variant="p" color="inherit">
              No environment variables are associated with this function.
            </Box>
          </Box>
        }
      />

      <Modal
        visible={editGeneral}
        onDismiss={() => setEditGeneral(false)}
        header="Edit basic settings"
        footer={footer(
          () =>
            save({
              Description: description,
              MemorySize: Number(memory),
              Timeout: Number(timeout),
              Handler: handler,
              Runtime: runtime as Runtime,
            }),
          () => setEditGeneral(false),
        )}
      >
        <SpaceBetween size="l">
          <FormField label="Description - optional">
            <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
          </FormField>
          <FormField label="Memory" constraintText="Set memory to between 128 MB and 10240 MB.">
            <Input type="number" value={memory} onChange={(e) => setMemory(e.detail.value)} />
          </FormField>
          <FormField label="Timeout" constraintText="In seconds. The maximum is 900.">
            <Input type="number" value={timeout} onChange={(e) => setTimeoutValue(e.detail.value)} />
          </FormField>
          <FormField label="Runtime">
            <Select
              selectedOption={runtimeOptions.find((r) => r.value === runtime) ?? null}
              options={runtimeOptions}
              onChange={(e) => setRuntime(e.detail.selectedOption.value ?? "")}
            />
          </FormField>
          <FormField label="Handler">
            <Input value={handler} onChange={(e) => setHandler(e.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        size="large"
        visible={editEnv}
        onDismiss={() => setEditEnv(false)}
        header="Edit environment variables"
        footer={footer(
          () => save({ Environment: { Variables: Object.fromEntries(env.filter((v) => v.key).map((v) => [v.key, v.value])) } }),
          () => setEditEnv(false),
        )}
      >
        <AttributeEditor
          items={env}
          addButtonText="Add environment variable"
          removeButtonText="Remove"
          empty="No environment variables are associated with this function."
          onAddButtonClick={() => setEnv([...env, { key: "", value: "" }])}
          onRemoveButtonClick={(e) => setEnv(env.filter((_, i) => i !== e.detail.itemIndex))}
          definition={[
            {
              label: "Key",
              control: (item, i) => (
                <Input value={item.key} onChange={(e) => setEnv(env.map((v, j) => (j === i ? { ...v, key: e.detail.value } : v)))} />
              ),
            },
            {
              label: "Value",
              control: (item, i) => (
                <Input value={item.value} onChange={(e) => setEnv(env.map((v, j) => (j === i ? { ...v, value: e.detail.value } : v)))} />
              ),
            },
          ]}
        />
      </Modal>
    </SpaceBetween>
  );
}

// ---------------------------------------------------------------- Page

export default function FunctionDetail() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "code";
  const [deleting, setDeleting] = useState(false);

  const fn = useLoad(() => lambda.send(new GetFunctionCommand({ FunctionName: name })), [name]);
  const cfg = fn.data?.Configuration;

  // A new function starts as Pending. Poll until it settles.
  useEffect(() => {
    if (cfg?.State !== "Pending" && cfg?.LastUpdateStatus !== "InProgress") return;
    const id = setTimeout(() => fn.reload(true), 1500);
    return () => clearTimeout(id);
  }, [cfg?.State, cfg?.LastUpdateStatus, cfg?.RevisionId, fn.reload]);

  const remove = async () => {
    try {
      await lambda.send(new DeleteFunctionCommand({ FunctionName: name }));
      notify.success(`Deleted the function ${name}.`);
      navigate("/lambda/functions");
    } catch (e) {
      notify.error("Could not delete the function", e);
      setDeleting(false);
    }
  };

  const state = cfg?.State ?? "Active";

  return (
    <Shell
      service="lambda"
      breadcrumbs={[
        { text: "Lambda", href: "/lambda/functions" },
        { text: "Functions", href: "/lambda/functions" },
        { text: name, href: `/lambda/functions/${name}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => fn.reload()} />
                <Button onClick={() => setDeleting(true)} disabled={!cfg}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {fn.error ? (
          <Alert type="error" header="Could not load the function">
            {fn.error}
          </Alert>
        ) : !cfg ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Function overview</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Function ARN">
                  <CopyToClipboard
                    variant="inline"
                    textToCopy={cfg.FunctionArn ?? ""}
                    copyButtonAriaLabel="Copy ARN"
                    copySuccessText="ARN copied"
                    copyErrorText="ARN failed to copy"
                  />
                </Pair>
                <Pair label="State">
                  <StatusIndicator type={state === "Active" ? "success" : state === "Failed" ? "error" : "in-progress"}>{state}</StatusIndicator>
                </Pair>
                <Pair label="Last modified">{formatDate(cfg.LastModified)}</Pair>
                <Pair label="Runtime">{cfg.Runtime ?? "-"}</Pair>
                <Pair label="Handler">{cfg.Handler ?? "-"}</Pair>
                <Pair label="Code size">{formatBytes(cfg.CodeSize)}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              activeTabId={tab}
              onChange={(e) => setParams({ tab: e.detail.activeTabId }, { replace: true })}
              tabs={[
                {
                  id: "code",
                  label: "Code",
                  content: <CodeTab cfg={cfg} codeUrl={fn.data?.Code?.Location} onDeployed={() => fn.reload(true)} />,
                },
                { id: "test", label: "Test", content: <TestTab cfg={cfg} /> },
                {
                  id: "monitor",
                  label: "Monitor",
                  content: (
                    <SpaceBetween size="m">
                      <Box>
                        Logs are stored in the log group{" "}
                        <RouterLink to={`/cloudwatch/log-group?name=${encodeURIComponent(logGroupOf(cfg))}`}>{logGroupOf(cfg)}</RouterLink>.
                      </Box>
                      <LogEvents group={logGroupOf(cfg)} title="Recent logs" missingIsEmpty />
                    </SpaceBetween>
                  ),
                },
                { id: "configuration", label: "Configuration", content: <ConfigurationTab cfg={cfg} onSaved={() => fn.reload(true)} /> },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>
      <ConfirmDelete
        visible={deleting}
        title={`Delete ${name}`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting a function permanently removes the function code. The related logs remain in CloudWatch."
      />
    </Shell>
  );
}
