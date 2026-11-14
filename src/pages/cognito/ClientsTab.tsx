import { useState } from "react";
import { CreateUserPoolClientCommand, DeleteUserPoolClientCommand, type ExplicitAuthFlowsType, type UserPoolClientType } from "@aws-sdk/client-cognito-identity-provider";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Multiselect from "@cloudscape-design/components/multiselect";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { cognito } from "../../clients/cognito";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { AUTH_FLOWS, type Load } from "./cognitoutil";
import { TestSignIn } from "./TestSignIn";

const DEFAULT_FLOWS = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"];
const between = (text: string, min: number, max: number) => Number.isInteger(Number(text)) && Number(text) >= min && Number(text) <= max;

/** The App clients tab of a user pool: list, create, show the secret, test a sign-in, delete. */
export function ClientsTab({ poolId, clients }: { poolId: string; clients: Load<UserPoolClientType[]> }) {
  const notify = useNotify();
  const form = useSubmit();
  const [selected, setSelected] = useState<UserPoolClientType[]>([]);
  const [modal, setModal] = useState<"create" | "delete" | undefined>(undefined);
  const [testing, setTesting] = useState<UserPoolClientType | undefined>(undefined);
  const [shown, setShown] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState(false);
  const [flows, setFlows] = useState(DEFAULT_FLOWS);
  const [accessMinutes, setAccessMinutes] = useState("60");
  const [idMinutes, setIdMinutes] = useState("60");
  const [refreshDays, setRefreshDays] = useState("30");
  const one = selected[0];

  const openCreate = () => {
    setName("");
    setSecret(false);
    setFlows(DEFAULT_FLOWS);
    setAccessMinutes("60");
    setIdMinutes("60");
    setRefreshDays("30");
    form.setError("");
    setModal("create");
  };

  const create = async () => {
    if (!/^[\w\s+=,.@-]{1,128}$/.test(name)) return form.setError("Use up to 128 letters, numbers, spaces and these characters in the name: + = , . @ - _");
    if (!flows.length) return form.setError("Choose at least one authentication flow.");
    if (!between(accessMinutes, 5, 1440) || !between(idMinutes, 5, 1440)) return form.setError("Enter from 5 to 1440 minutes for the access token and the ID token.");
    if (!between(refreshDays, 1, 3650)) return form.setError("Enter from 1 to 3650 days for the refresh token.");
    const ok = await form.run(async () => {
      await cognito.send(
        new CreateUserPoolClientCommand({
          UserPoolId: poolId,
          ClientName: name,
          GenerateSecret: secret,
          ExplicitAuthFlows: flows as ExplicitAuthFlowsType[],
          AccessTokenValidity: Number(accessMinutes),
          IdTokenValidity: Number(idMinutes),
          RefreshTokenValidity: Number(refreshDays),
          TokenValidityUnits: { AccessToken: "minutes", IdToken: "minutes", RefreshToken: "days" },
        }),
      );
      notify.success(`App client ${name} was created.`);
      clients.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      await cognito.send(new DeleteUserPoolClientCommand({ UserPoolId: poolId, ClientId: one?.ClientId }));
      notify.success(`App client ${one?.ClientName} was deleted.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the app client", e);
    }
    setModal(undefined);
    clients.reload();
  };

  const toggle = (id: string) => setShown(shown.includes(id) ? shown.filter((s) => s !== id) : [...shown, id]);

  return (
    <>
      <ResourceTable
        title="App clients"
        resourceName="app clients"
        variant="container"
        stickyHeader={false}
        filterPlaceholder="Search app clients by name or client ID"
        emptyDescription="An application signs users in through an app client."
        items={clients.data}
        loading={clients.loading}
        error={clients.error}
        onRefresh={() => clients.reload()}
        trackBy={(c) => c.ClientId ?? ""}
        selectionType="single"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create app client</Button>}
        actions={
          <>
            <Button disabled={!one} onClick={() => setTesting(one)}>
              Test sign-in
            </Button>
            <Button disabled={!one} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create app client
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "App client name", cell: (c) => c.ClientName, sortingField: "ClientName", isRowHeader: true },
          { id: "id", header: "Client ID", cell: (c) => <Copy text={c.ClientId} />, sortingField: "ClientId" },
          {
            id: "secret",
            header: "Client secret",
            cell: (c) =>
              c.ClientSecret ? (
                <SpaceBetween direction="horizontal" size="xs">
                  {shown.includes(c.ClientId ?? "") ? <Copy text={c.ClientSecret} /> : <span>{"•".repeat(16)}</span>}
                  <Button variant="inline-link" onClick={() => toggle(c.ClientId ?? "")}>
                    {shown.includes(c.ClientId ?? "") ? "Hide client secret" : "Show client secret"}
                  </Button>
                </SpaceBetween>
              ) : (
                "-"
              ),
          },
          { id: "flows", header: "Authentication flows", cell: (c) => c.ExplicitAuthFlows?.join(", ") || "-" },
        ]}
        wrapLines
      />

      <FormModal visible={modal === "create"} size="large" header="Create app client" submitLabel="Create app client" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={create}>
        <FormField label="App client name">
          <Input value={name} placeholder="my-app-client" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <Checkbox checked={secret} onChange={(e) => setSecret(e.detail.checked)} description="For server-side applications. An application in a browser or on a phone can't keep a secret.">
          Generate a client secret
        </Checkbox>
        <FormField label="Authentication flows" description="The ways this app client lets a user sign in.">
          <Multiselect
            selectedOptions={AUTH_FLOWS.filter((f) => flows.includes(f.value))}
            onChange={(e) => setFlows(e.detail.selectedOptions.map((o) => o.value ?? ""))}
            options={AUTH_FLOWS}
            placeholder="Choose authentication flows"
          />
        </FormField>
        <ColumnLayout columns={3}>
          <FormField label="Access token expiration" constraintText="In minutes.">
            <Input type="number" value={accessMinutes} onChange={(e) => setAccessMinutes(e.detail.value)} />
          </FormField>
          <FormField label="ID token expiration" constraintText="In minutes.">
            <Input type="number" value={idMinutes} onChange={(e) => setIdMinutes(e.detail.value)} />
          </FormField>
          <FormField label="Refresh token expiration" constraintText="In days.">
            <Input type="number" value={refreshDays} onChange={(e) => setRefreshDays(e.detail.value)} />
          </FormField>
        </ColumnLayout>
      </FormModal>

      <TestSignIn client={testing} onDismiss={() => setTesting(undefined)} />

      <ConfirmDelete visible={modal === "delete"} title={`Delete app client ${one?.ClientName ?? ""}`} onCancel={() => setModal(undefined)} onConfirm={remove} warning="Applications that use this app client can no longer sign users in." />
    </>
  );
}
