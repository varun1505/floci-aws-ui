import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  ListSecretVersionIdsCommand,
  PutSecretValueCommand,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { secrets } from "../../clients/secrets";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { secretHref } from "./Secrets";
import { SecretValueEditor, draftError, draftFrom, draftToString, type SecretDraft } from "./SecretValueEditor";

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children || "-"}</div>
    </div>
  );
}

const mono = { fontFamily: "Monaco, Menlo, Consolas, monospace", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" } as const;

export default function SecretDetail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const name = params.get("name") ?? "";

  const secret = useLoad(() => secrets.send(new DescribeSecretCommand({ SecretId: name })), [name]);
  const versions = useLoad(async () => (await secrets.send(new ListSecretVersionIdsCommand({ SecretId: name }))).Versions ?? [], [name]);

  // The value is fetched only when the user asks for it, the same as the AWS console.
  const [value, setValue] = useState<string | undefined>(undefined);
  const [valueError, setValueError] = useState("");
  const [retrieving, setRetrieving] = useState(false);
  const [draft, setDraft] = useState<SecretDraft | null>(null);
  const [draftProblem, setDraftProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editDescription, setEditDescription] = useState<string | null>(null);

  const retrieve = async () => {
    setRetrieving(true);
    setValueError("");
    try {
      const res = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
      setValue(res.SecretString ?? (res.SecretBinary ? "(binary secret)" : ""));
    } catch (e) {
      setValueError(errorMessage(e));
    }
    setRetrieving(false);
  };

  const save = async () => {
    if (!draft) return;
    const problem = draftError(draft);
    if (problem) return setDraftProblem(problem);
    setBusy(true);
    try {
      const next = draftToString(draft);
      await secrets.send(new PutSecretValueCommand({ SecretId: name, SecretString: next }));
      notify.success("Your secret value has been successfully edited.");
      setValue(next);
      setDraft(null);
      secret.reload(true);
      versions.reload(true);
    } catch (e) {
      setDraftProblem(errorMessage(e));
    }
    setBusy(false);
  };

  const saveDescription = async () => {
    setBusy(true);
    try {
      await secrets.send(new UpdateSecretCommand({ SecretId: name, Description: editDescription ?? "" }));
      notify.success("The description was updated.");
      setEditDescription(null);
      secret.reload(true);
    } catch (e) {
      notify.error("Could not update the description", e);
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      await secrets.send(new DeleteSecretCommand({ SecretId: name, ForceDeleteWithoutRecovery: true }));
      notify.success(`Deleted the secret ${name}.`);
      navigate("/secretsmanager/secrets");
    } catch (e) {
      notify.error("Could not delete the secret", e);
      setDeleting(false);
    }
  };

  const shown = value === undefined ? null : draftFrom(value);
  const s = secret.data;

  return (
    <Shell
      service="secretsmanager"
      breadcrumbs={[
        { text: "Secrets Manager", href: "/secretsmanager/secrets" },
        { text: "Secrets", href: "/secretsmanager/secrets" },
        { text: name, href: secretHref(name) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (secret.reload(), versions.reload())} />
                <Button onClick={() => setDeleting(true)}>Delete secret</Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        <SpaceBetween size="l">
          {secret.error && (
            <Alert type="error" header="Could not load the secret">
              {secret.error}
            </Alert>
          )}
          <Container header={<Header variant="h2" actions={<Button onClick={() => setEditDescription(s?.Description ?? "")}>Edit description</Button>}>Secret details</Header>}>
            <ColumnLayout columns={2} variant="text-grid">
              <SpaceBetween size="l">
                <Pair label="Secret name">{s?.Name}</Pair>
                <Pair label="Secret ARN">
                  {s?.ARN && <CopyToClipboard variant="inline" textToCopy={s.ARN} copyButtonAriaLabel="Copy ARN" copySuccessText="ARN copied" copyErrorText="Failed to copy" />}
                </Pair>
              </SpaceBetween>
              <SpaceBetween size="l">
                <Pair label="Secret description">{s?.Description}</Pair>
                <Pair label="Created / last changed">
                  {formatDate(s?.CreatedDate)} / {formatDate(s?.LastChangedDate)}
                </Pair>
              </SpaceBetween>
            </ColumnLayout>
          </Container>

          <Container
            header={
              <Header
                variant="h2"
                description="Retrieve and view the secret value."
                actions={
                  value === undefined ? (
                    <Button loading={retrieving} onClick={retrieve}>
                      Retrieve secret value
                    </Button>
                  ) : (
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button onClick={() => setValue(undefined)}>Close</Button>
                      <Button
                        onClick={() => {
                          setDraftProblem("");
                          setDraft(draftFrom(value));
                        }}
                      >
                        Edit
                      </Button>
                    </SpaceBetween>
                  )
                }
              >
                Secret value
              </Header>
            }
          >
            {valueError ? (
              <Alert type="error">{valueError}</Alert>
            ) : shown === null ? (
              <Box color="text-status-inactive">The value is hidden. Choose Retrieve secret value to show it.</Box>
            ) : shown.mode === "pairs" ? (
              <Table
                variant="embedded"
                items={shown.pairs}
                columnDefinitions={[
                  { id: "key", header: "Secret key", cell: (p) => p.key, isRowHeader: true },
                  {
                    id: "value",
                    header: "Secret value",
                    cell: (p) => <CopyToClipboard variant="inline" textToCopy={p.value} copyButtonAriaLabel="Copy value" copySuccessText="Value copied" copyErrorText="Failed to copy" />,
                  },
                ]}
              />
            ) : (
              <div style={mono}>{value}</div>
            )}
          </Container>

          <Table
            header={<Header variant="h2" counter={`(${versions.data?.length ?? 0})`}>Versions</Header>}
            loading={versions.loading}
            loadingText="Loading versions"
            items={versions.data ?? []}
            columnDefinitions={[
              { id: "id", header: "Version ID", cell: (v) => v.VersionId, isRowHeader: true },
              { id: "stages", header: "Staging labels", cell: (v) => v.VersionStages?.join(", ") || "-" },
              { id: "accessed", header: "Last accessed", cell: (v) => formatDate(v.LastAccessedDate) },
              { id: "created", header: "Created on", cell: (v) => formatDate(v.CreatedDate) },
            ]}
            empty={<Box textAlign="center">No versions</Box>}
          />
        </SpaceBetween>
      </ContentLayout>

      <Modal
        size="large"
        visible={draft !== null}
        onDismiss={() => setDraft(null)}
        header="Edit secret value"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={save}>
                Save
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField errorText={draftProblem} stretch>
          {draft && <SecretValueEditor draft={draft} onChange={setDraft} />}
        </FormField>
      </Modal>

      <Modal
        visible={editDescription !== null}
        onDismiss={() => setEditDescription(null)}
        header="Edit description"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setEditDescription(null)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={saveDescription}>
                Save
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField label="Description">
          <Input value={editDescription ?? ""} onChange={(e) => setEditDescription(e.detail.value)} />
        </FormField>
      </Modal>

      <ConfirmDelete
        visible={deleting}
        title="Delete secret"
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="The secret is deleted immediately, with no recovery window. Applications that read it will start to fail."
      />
    </Shell>
  );
}
