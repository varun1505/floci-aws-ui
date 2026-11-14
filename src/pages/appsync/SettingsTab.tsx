import { useState } from "react";
import { type ApiKey, CreateApiKeyCommand, DeleteApiKeyCommand, type GraphqlApi, UpdateGraphqlApiCommand } from "@aws-sdk/client-appsync";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { appsync } from "../../clients/appsync";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { authLabel, keyDate, listKeys } from "./appsyncutil";

/** The settings of an API: its name and its API keys. */
export function SettingsTab({ api, onChange }: { api: GraphqlApi; onChange: () => void }) {
  const apiId = api.apiId ?? "";
  const notify = useNotify();
  const keys = useLoad(() => listKeys(apiId), [apiId]);
  const form = useSubmit();
  const [selected, setSelected] = useState<ApiKey[]>([]);
  const [modal, setModal] = useState<"rename" | "key" | "delete" | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [days, setDays] = useState("7");

  const open = (which: "rename" | "key") => {
    setName(api.name ?? "");
    setDescription("");
    setDays("7");
    form.setError("");
    setModal(which);
  };

  const rename = async () => {
    if (!/^[_A-Za-z0-9 -]{1,65}$/.test(name.trim())) return form.setError("Enter a name of 1 to 65 characters. Use letters, numbers, spaces, hyphens and underscores.");
    const ok = await form.run(async () => {
      // An update replaces the settings, so send the current ones along with the new name.
      await appsync.send(
        new UpdateGraphqlApiCommand({
          apiId,
          name: name.trim(),
          authenticationType: api.authenticationType,
          userPoolConfig: api.userPoolConfig,
          openIDConnectConfig: api.openIDConnectConfig,
          lambdaAuthorizerConfig: api.lambdaAuthorizerConfig,
          additionalAuthenticationProviders: api.additionalAuthenticationProviders,
          logConfig: api.logConfig,
          xrayEnabled: api.xrayEnabled,
        }),
      );
      notify.success(`The API is now named ${name.trim()}.`);
      onChange();
    });
    if (ok) setModal(undefined);
  };

  const createKey = async () => {
    const n = Number(days);
    if (!(Number.isInteger(n) && n >= 1 && n <= 365)) return form.setError("Enter a number of days from 1 to 365.");
    const ok = await form.run(async () => {
      const res = await appsync.send(new CreateApiKeyCommand({ apiId, description: description || undefined, expires: Math.floor(Date.now() / 1000) + n * 86400 }));
      notify.success(`API key ${res.apiKey?.id ?? ""} was created.`);
      keys.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const removeKey = async () => {
    try {
      for (const k of selected) await appsync.send(new DeleteApiKeyCommand({ apiId, id: k.id }));
      notify.success(selected.length === 1 ? `API key ${selected[0].id} was deleted.` : `Deleted ${selected.length} API keys.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the API key", e);
    }
    setModal(undefined);
    keys.reload(true);
  };

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header variant="h2" actions={<Button onClick={() => open("rename")}>Edit</Button>}>
            API details
          </Header>
        }
      >
        <ColumnLayout columns={3} variant="text-grid">
          <Pair label="API name">{api.name}</Pair>
          <Pair label="Primary authorization mode">{authLabel(api.authenticationType)}</Pair>
          <Pair label="Additional authorization modes">{api.additionalAuthenticationProviders?.map((p) => authLabel(p.authenticationType)).join(", ")}</Pair>
          {api.userPoolConfig && <Pair label="User pool ID">{api.userPoolConfig.userPoolId}</Pair>}
          {api.lambdaAuthorizerConfig && <Pair label="Authorizer function">{api.lambdaAuthorizerConfig.authorizerUri}</Pair>}
        </ColumnLayout>
      </Container>

      <ResourceTable
        title="API keys"
        description="Callers send the key ID in the x-api-key header."
        resourceName="API keys"
        variant="container"
        stickyHeader={false}
        global
        items={keys.data}
        loading={keys.loading}
        error={keys.error}
        onRefresh={() => keys.reload()}
        trackBy={(k) => k.id ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => open("key")}>Create API key</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button onClick={() => open("key")}>Create API key</Button>
          </>
        }
        columns={[
          { id: "id", header: "API key", cell: (k) => <Copy text={k.id} />, isRowHeader: true },
          { id: "description", header: "Description", cell: (k) => k.description || "-" },
          { id: "expires", header: "Expires", cell: (k) => formatDate(keyDate(k.expires)), sortingField: "expires" },
        ]}
      />

      <FormModal visible={modal === "rename"} header="Edit API details" submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={rename}>
        <FormField label="API name">
          <Input value={name} onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "key"} header="Create API key" submitLabel="Create API key" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={createKey}>
        <FormField label="Description - optional">
          <Input value={description} placeholder="Key for local tests" onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
        <FormField label="Expires after (days)" constraintText="From 1 to 365 days.">
          <Input type="number" value={days} onChange={(e) => setDays(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title={selected.length === 1 ? "Delete the API key?" : `Delete ${selected.length} API keys?`} onCancel={() => setModal(undefined)} onConfirm={removeKey}>
        Callers that use a deleted key get an error.
      </ConfirmDelete>
    </SpaceBetween>
  );
}
