import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteParameterCommand, DescribeParametersCommand, GetParameterCommand, GetParameterHistoryCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import { ssm } from "../../clients/ssm";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { parameterHref } from "./Parameters";

export default function ParameterDetail() {
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const param = useLoad(async () => {
    const [value, meta] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true })),
      ssm.send(new DescribeParametersCommand({ ParameterFilters: [{ Key: "Name", Option: "Equals", Values: [name] }] })).catch(() => undefined),
    ]);
    return { ...meta?.Parameters?.find((p) => p.Name === name), ...value.Parameter };
  }, [name]);
  const history = useLoad(async () => ((await ssm.send(new GetParameterHistoryCommand({ Name: name, WithDecryption: true }))).Parameters ?? []).reverse(), [name]);
  const form = useSubmit();
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");

  const p = param.data;
  const secure = p?.Type === "SecureString";

  const openEdit = () => {
    setValue(p?.Value ?? "");
    setDescription(p?.Description ?? "");
    form.setError("");
    setEditing(true);
  };

  const save = async () => {
    if (!value) return form.setError("Value is required.");
    const ok = await form.run(async () => {
      await ssm.send(new PutParameterCommand({ Name: name, Type: p?.Type, Value: value, Description: description || undefined, Overwrite: true }));
      notify.success(`Edit parameter request succeeded for ${name}.`);
      param.reload(true);
      history.reload(true);
    });
    if (ok) setEditing(false);
  };

  const remove = async () => {
    try {
      await ssm.send(new DeleteParameterCommand({ Name: name }));
      notify.success(`Deleted ${name}.`);
      navigate("/ssm/parameters");
    } catch (e) {
      notify.error("Could not delete the parameter", e);
      setDeleting(false);
    }
  };

  const masked = (v?: string) => (secure && !show ? "•".repeat(Math.min(v?.length ?? 8, 24)) : v);

  return (
    <Shell
      service="ssm"
      breadcrumbs={[
        { text: "Systems Manager", href: "/ssm/parameters" },
        { text: "Parameter Store", href: "/ssm/parameters" },
        { text: name, href: parameterHref(name) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (param.reload(), history.reload())} />
                <Button onClick={() => setDeleting(true)}>Delete</Button>
                <Button variant="primary" disabled={!p} onClick={openEdit}>
                  Edit
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {param.error ? (
          <Alert type="error" header="Could not load the parameter">
            {param.error}
          </Alert>
        ) : !p ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <Tabs
            tabs={[
              {
                id: "overview",
                label: "Overview",
                content: (
                  <Container header={<Header variant="h2">Parameter details</Header>}>
                    <SpaceBetween size="l">
                      <ColumnLayout columns={3} variant="text-grid">
                        <Pair label="Name">
                          <Copy text={p.Name} />
                        </Pair>
                        <Pair label="Description">{p.Description}</Pair>
                        <Pair label="ARN">
                          <Copy text={p.ARN} />
                        </Pair>
                        <Pair label="Tier">{p.Tier ?? "Standard"}</Pair>
                        <Pair label="Type">{p.Type}</Pair>
                        <Pair label="Data type">{p.DataType}</Pair>
                        <Pair label="Version">{p.Version}</Pair>
                        <Pair label="Last modified date">{formatDate(p.LastModifiedDate)}</Pair>
                        {secure && <Pair label="KMS key ID">{p.KeyId}</Pair>}
                      </ColumnLayout>
                      <div>
                        <Box variant="awsui-key-label">Value</Box>
                        <SpaceBetween size="xs">
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 13 }}>{masked(p.Value)}</pre>
                          <SpaceBetween direction="horizontal" size="xs">
                            {secure && (
                              <Button variant="inline-link" onClick={() => setShow(!show)}>
                                {show ? "Hide decrypted value" : "Show decrypted value"}
                              </Button>
                            )}
                            <Copy text={p.Value} />
                          </SpaceBetween>
                        </SpaceBetween>
                      </div>
                    </SpaceBetween>
                  </Container>
                ),
              },
              {
                id: "history",
                label: "History",
                content: (
                  <Table
                    header={<Header variant="h2" counter={`(${history.data?.length ?? 0})`}>History</Header>}
                    loading={history.loading}
                    loadingText="Loading history"
                    items={history.data ?? []}
                    columnDefinitions={[
                      { id: "version", header: "Version", cell: (h) => h.Version, isRowHeader: true },
                      { id: "value", header: "Value", cell: (h) => masked(h.Value) },
                      { id: "type", header: "Type", cell: (h) => h.Type },
                      { id: "modified", header: "Last modified date", cell: (h) => formatDate(h.LastModifiedDate) },
                      { id: "user", header: "Last modified user", cell: (h) => h.LastModifiedUser ?? "-" },
                    ]}
                    empty={<Box textAlign="center">No history</Box>}
                  />
                ),
              },
            ]}
          />
        )}
      </ContentLayout>

      <FormModal visible={editing} size="large" header={`Edit ${name}`} submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setEditing(false)} onSubmit={save}>
        <FormField label="Description - optional">
          <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
        <FormField label="Value" description="Saving creates a new version." stretch>
          <Textarea value={value} rows={5} onChange={(e) => setValue(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={deleting} title={`Delete ${name}`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Applications that read a deleted parameter will fail." />
    </Shell>
  );
}
