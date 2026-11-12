import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  CancelKeyDeletionCommand,
  CreateAliasCommand,
  DecryptCommand,
  DeleteAliasCommand,
  DescribeKeyCommand,
  DisableKeyCommand,
  EnableKeyCommand,
  EncryptCommand,
  GetKeyPolicyCommand,
  GetKeyRotationStatusCommand,
  ScheduleKeyDeletionCommand,
} from "@aws-sdk/client-kms";
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
import { kms } from "../../clients/kms";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { KeyState, USAGE_LABEL, listAliases } from "./kmsutil";

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0));

export default function KeyDetail() {
  const { id = "" } = useParams();
  const notify = useNotify();
  const key = useLoad(async () => (await kms.send(new DescribeKeyCommand({ KeyId: id }))).KeyMetadata, [id]);
  const aliases = useLoad(async () => (await listAliases()).filter((a) => a.TargetKeyId === id), [id]);
  const policy = useLoad(async () => (await kms.send(new GetKeyPolicyCommand({ KeyId: id, PolicyName: "default" }))).Policy, [id]);
  const rotation = useLoad(async () => (await kms.send(new GetKeyRotationStatusCommand({ KeyId: id }))).KeyRotationEnabled, [id]);
  const form = useSubmit();
  const [modal, setModal] = useState<"alias" | "delete" | undefined>(undefined);
  const [alias, setAlias] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [cryptoError, setCryptoError] = useState("");

  const k = key.data;
  const customer = k?.KeyManager !== "AWS";
  const state = k?.KeyState;
  const title = aliases.data?.[0]?.AliasName?.replace(/^alias\//, "") ?? id;

  const change = async (label: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      notify.success(label);
    } catch (e) {
      notify.error("Could not update the key", e);
    }
    setBusy(false);
    key.reload(true);
  };

  const addAlias = async () => {
    if (!/^[a-zA-Z0-9/_-]+$/.test(alias)) return form.setError("Use letters, numbers and these characters: / _ -");
    const ok = await form.run(async () => {
      await kms.send(new CreateAliasCommand({ AliasName: `alias/${alias.replace(/^alias\//, "")}`, TargetKeyId: id }));
      notify.success(`Alias ${alias} created.`);
      aliases.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const removeAlias = (name: string) =>
    change(`Alias ${name} deleted.`, async () => {
      await kms.send(new DeleteAliasCommand({ AliasName: name }));
      aliases.reload(true);
    });

  const schedule = async () => {
    const n = Number(days);
    if (!(n >= 7 && n <= 30)) return form.setError("Enter a waiting period from 7 to 30 days.");
    const ok = await form.run(async () => {
      await kms.send(new ScheduleKeyDeletionCommand({ KeyId: id, PendingWindowInDays: n }));
      notify.success(`Key ${id} is scheduled for deletion in ${n} days.`);
      key.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const crypt = async (encrypt: boolean) => {
    setCryptoError("");
    setOutput("");
    try {
      if (encrypt) {
        const res = await kms.send(new EncryptCommand({ KeyId: id, Plaintext: new TextEncoder().encode(input) }));
        setOutput(toBase64(res.CiphertextBlob ?? new Uint8Array()));
      } else {
        const res = await kms.send(new DecryptCommand({ KeyId: id, CiphertextBlob: fromBase64(input) }));
        setOutput(new TextDecoder().decode(res.Plaintext));
      }
    } catch (e) {
      setCryptoError(errorMessage(e));
    }
  };

  return (
    <Shell
      service="kms"
      breadcrumbs={[
        { text: "KMS", href: "/kms/keys" },
        customer ? { text: "Customer managed keys", href: "/kms/keys" } : { text: "AWS managed keys", href: "/kms/aws-keys" },
        { text: id, href: `/kms/keys/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (key.reload(), aliases.reload(), policy.reload())} />
                {customer && state === "Enabled" && (
                  <Button loading={busy} onClick={() => change("Key disabled.", () => kms.send(new DisableKeyCommand({ KeyId: id })))}>
                    Disable
                  </Button>
                )}
                {customer && state === "Disabled" && (
                  <Button loading={busy} onClick={() => change("Key enabled.", () => kms.send(new EnableKeyCommand({ KeyId: id })))}>
                    Enable
                  </Button>
                )}
                {customer && state === "PendingDeletion" && (
                  <Button loading={busy} onClick={() => change("Key deletion cancelled. The key is disabled.", () => kms.send(new CancelKeyDeletionCommand({ KeyId: id })))}>
                    Cancel key deletion
                  </Button>
                )}
                {customer && state !== "PendingDeletion" && (
                  <Button
                    disabled={!k}
                    onClick={() => {
                      form.setError("");
                      setModal("delete");
                    }}
                  >
                    Schedule key deletion
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            {title}
          </Header>
        }
      >
        {key.error ? (
          <Alert type="error" header="Could not load the key">
            {key.error}
          </Alert>
        ) : !k ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            {state === "PendingDeletion" && <Alert type="warning">This key is scheduled for deletion on {formatDate(k.DeletionDate)}. It can't be used until you cancel the deletion.</Alert>}
            <Container header={<Header variant="h2">General configuration</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Alias">{aliases.data?.map((a) => a.AliasName?.replace(/^alias\//, "")).join(", ")}</Pair>
                <Pair label="Status">
                  <KeyState state={state} />
                </Pair>
                <Pair label="Creation date">{formatDate(k.CreationDate)}</Pair>
                <Pair label="Key ID">
                  <Copy text={k.KeyId} />
                </Pair>
                <Pair label="ARN">
                  <Copy text={k.Arn} />
                </Pair>
                <Pair label="Description">{k.Description}</Pair>
                <Pair label="Key spec">{k.KeySpec}</Pair>
                <Pair label="Key usage">{USAGE_LABEL[k.KeyUsage ?? ""] ?? k.KeyUsage}</Pair>
                <Pair label="Origin">{k.Origin}</Pair>
                <Pair label="Key manager">{customer ? "Customer" : "AWS"}</Pair>
                <Pair label="Automatic key rotation">{rotation.data === undefined ? undefined : rotation.data ? "Enabled" : "Disabled"}</Pair>
                <Pair label="Regionality">{k.MultiRegion ? "Multi-Region" : "Single Region"}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "policy",
                  label: "Key policy",
                  content: (
                    <Container header={<Header variant="h2">Key policy</Header>}>{policy.error ? <Alert type="error">{policy.error}</Alert> : <JsonBlock value={policy.data} />}</Container>
                  ),
                },
                {
                  id: "aliases",
                  label: "Aliases",
                  content: (
                    <Table
                      header={
                        <Header
                          variant="h2"
                          counter={`(${aliases.data?.length ?? 0})`}
                          actions={
                            customer && (
                              <Button
                                onClick={() => {
                                  setAlias("");
                                  form.setError("");
                                  setModal("alias");
                                }}
                              >
                                Create alias
                              </Button>
                            )
                          }
                        >
                          Aliases
                        </Header>
                      }
                      loading={aliases.loading}
                      loadingText="Loading aliases"
                      items={aliases.data ?? []}
                      columnDefinitions={[
                        { id: "name", header: "Alias name", cell: (a) => a.AliasName?.replace(/^alias\//, ""), isRowHeader: true },
                        { id: "full", header: "Alias for the API", cell: (a) => <Copy text={a.AliasName} /> },
                        { id: "actions", header: "Actions", cell: (a) => (customer ? <Button variant="inline-link" onClick={() => removeAlias(a.AliasName ?? "")}>Delete</Button> : "-") },
                      ]}
                      empty={<Box textAlign="center">No aliases</Box>}
                    />
                  ),
                },
                ...(k.KeyUsage === "ENCRYPT_DECRYPT" && k.KeySpec === "SYMMETRIC_DEFAULT"
                  ? [
                      {
                        id: "try",
                        label: "Encrypt and decrypt",
                        content: (
                          <Container header={<Header variant="h2" description="Try the key. Encrypt gives base64 ciphertext. Decrypt takes base64 ciphertext.">Encrypt and decrypt</Header>}>
                            <SpaceBetween size="l">
                              <FormField label="Input" stretch>
                                <Textarea value={input} rows={4} onChange={(e) => setInput(e.detail.value)} spellcheck={false} />
                              </FormField>
                              <SpaceBetween direction="horizontal" size="xs">
                                <Button disabled={!input || state !== "Enabled"} onClick={() => crypt(true)}>
                                  Encrypt
                                </Button>
                                <Button disabled={!input || state !== "Enabled"} onClick={() => crypt(false)}>
                                  Decrypt
                                </Button>
                              </SpaceBetween>
                              {cryptoError && <Alert type="error">{cryptoError}</Alert>}
                              {output && (
                                <Pair label="Output">
                                  <Copy text={output} />
                                </Pair>
                              )}
                            </SpaceBetween>
                          </Container>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={modal === "alias"} header="Create alias" submitLabel="Create alias" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={addAlias}>
        <FormField label="Alias name">
          <Input value={alias} placeholder="my-app-key" onChange={(e) => setAlias(e.detail.value)} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "delete"} header="Schedule key deletion" submitLabel="Schedule deletion" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={schedule}>
        <Alert type="warning">After the waiting period, the key is deleted. Data encrypted with it can never be decrypted again.</Alert>
        <FormField label="Waiting period (in days)" constraintText="From 7 to 30 days.">
          <Input type="number" value={days} onChange={(e) => setDays(e.detail.value)} />
        </FormField>
      </FormModal>
    </Shell>
  );
}
