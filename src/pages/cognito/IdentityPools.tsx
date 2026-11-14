import { useState } from "react";
import { CreateIdentityPoolCommand, DeleteIdentityPoolCommand, DescribeIdentityPoolCommand, type DescribeIdentityPoolCommandOutput, GetIdentityPoolRolesCommand, ListIdentityPoolsCommand } from "@aws-sdk/client-cognito-identity";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { cognitoIdentity } from "../../clients/cognitoIdentity";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { ACCOUNT_ID, getRegion } from "../../config";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listClients, listPools, poolHref } from "./cognitoutil";

type Pool = DescribeIdentityPoolCommandOutput;

/** Every identity pool with its settings. The list call gives only names and IDs, so each pool needs one more call. */
async function listIdentityPools(): Promise<Pool[]> {
  const ids: string[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cognitoIdentity.send(new ListIdentityPoolsCommand({ MaxResults: 60, NextToken }));
    ids.push(...(res.IdentityPools ?? []).map((p) => p.IdentityPoolId ?? ""));
    NextToken = res.NextToken;
  } while (NextToken);
  return Promise.all(ids.map((IdentityPoolId) => cognitoIdentity.send(new DescribeIdentityPoolCommand({ IdentityPoolId }))));
}

/** The user pool ID in a provider name such as cognito-idp.us-east-1.amazonaws.com/us-east-1_abc. */
const userPoolOf = (providerName?: string) => providerName?.split("/").pop() ?? "";

export default function IdentityPools() {
  const notify = useNotify();
  const list = useLoad(listIdentityPools, []);
  const userPools = useLoad(listPools, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Pool[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [guest, setGuest] = useState(false);
  const [userPool, setUserPool] = useState("");
  const [client, setClient] = useState("");
  const clients = useLoad(async () => (userPool ? listClients(userPool) : []), [userPool]);
  const one = selected[0];
  const roles = useLoad(async () => (one?.IdentityPoolId ? (await cognitoIdentity.send(new GetIdentityPoolRolesCommand({ IdentityPoolId: one.IdentityPoolId }))).Roles : undefined), [one?.IdentityPoolId]);

  const openCreate = () => {
    setName("");
    setGuest(false);
    setUserPool("");
    setClient("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[\w\s+=,.@-]{1,128}$/.test(name)) return form.setError("Use up to 128 letters, numbers, spaces and these characters in the name: + = , . @ - _");
    if (userPool && !client) return form.setError("Choose an app client of the user pool.");
    const ok = await form.run(async () => {
      await cognitoIdentity.send(
        new CreateIdentityPoolCommand({
          IdentityPoolName: name,
          AllowUnauthenticatedIdentities: guest,
          CognitoIdentityProviders: userPool ? [{ ProviderName: `cognito-idp.${getRegion()}.amazonaws.com/${userPool}`, ClientId: client, ServerSideTokenCheck: false }] : undefined,
        }),
      );
      notify.success(`Identity pool ${name} was created.`);
      list.reload(true);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      await cognitoIdentity.send(new DeleteIdentityPoolCommand({ IdentityPoolId: one?.IdentityPoolId }));
      notify.success(`Identity pool ${one?.IdentityPoolName} was deleted.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the identity pool", e);
    }
    setDeleting(false);
    list.reload();
  };

  const poolLabel = (id: string) => {
    const p = userPools.data?.find((x) => x.Id === id);
    return p ? `${p.Name} (${id})` : id;
  };

  return (
    <Shell service="cognito" breadcrumbs={[{ text: "Amazon Cognito", href: "/cognito/user-pools" }, { text: "Identity pools", href: "/cognito/identity-pools" }]}>
      <SpaceBetween size="l">
        <ResourceTable
          title="Identity pools"
          resourceName="identity pools"
          variant="container"
          stickyHeader={false}
          description="Choose an identity pool to see its details."
          filterPlaceholder="Search identity pools by name or ID"
          emptyDescription="An identity pool gives users temporary AWS credentials."
          emptyCli="cognito-identity create-identity-pool --identity-pool-name my-identity-pool --no-allow-unauthenticated-identities"
          items={list.data}
          loading={list.loading}
          error={list.error}
          onRefresh={() => list.reload()}
          trackBy={(p) => p.IdentityPoolId ?? ""}
          selectionType="single"
          selected={selected}
          onSelect={setSelected}
          emptyAction={<Button onClick={openCreate}>Create identity pool</Button>}
          actions={
            <>
              <Button disabled={!one} onClick={() => setDeleting(true)}>
                Delete
              </Button>
              <Button variant="primary" onClick={openCreate}>
                Create identity pool
              </Button>
            </>
          }
          columns={[
            { id: "name", header: "Identity pool name", cell: (p) => p.IdentityPoolName, sortingField: "IdentityPoolName", isRowHeader: true },
            { id: "id", header: "Identity pool ID", cell: (p) => <Copy text={p.IdentityPoolId} />, sortingField: "IdentityPoolId" },
            { id: "guest", header: "Guest access", cell: (p) => (p.AllowUnauthenticatedIdentities ? "Active" : "Inactive") },
            { id: "providers", header: "User pools", cell: (p) => p.CognitoIdentityProviders?.map((c) => userPoolOf(c.ProviderName)).join(", ") || "-" },
          ]}
        />

        {one && (
          <Container header={<Header variant="h2">{one.IdentityPoolName}</Header>}>
            <SpaceBetween size="l">
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Identity pool ID">
                  <Copy text={one.IdentityPoolId} />
                </Pair>
                <Pair label="ARN">
                  <Copy text={`arn:aws:cognito-identity:${getRegion()}:${ACCOUNT_ID}:identitypool/${one.IdentityPoolId}`} />
                </Pair>
                <Pair label="Guest access">{one.AllowUnauthenticatedIdentities ? "Active" : "Inactive"}</Pair>
                <Pair label="Basic (classic) authentication">{one.AllowClassicFlow ? "Active" : "Inactive"}</Pair>
                <Pair label="Authenticated role">{roles.data?.authenticated}</Pair>
                <Pair label="Guest role">{roles.data?.unauthenticated}</Pair>
              </ColumnLayout>
              <Pair label="User pool identity providers">
                {one.CognitoIdentityProviders?.length
                  ? one.CognitoIdentityProviders.map((c) => (
                      <div key={`${c.ProviderName}/${c.ClientId}`}>
                        <RouterLink to={poolHref(userPoolOf(c.ProviderName))}>{poolLabel(userPoolOf(c.ProviderName))}</RouterLink>, app client {c.ClientId}
                      </div>
                    ))
                  : undefined}
              </Pair>
            </SpaceBetween>
          </Container>
        )}
      </SpaceBetween>

      <FormModal visible={creating} header="Create identity pool" submitLabel="Create identity pool" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Identity pool name">
          <Input value={name} placeholder="my-identity-pool" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <Checkbox checked={guest} onChange={(e) => setGuest(e.detail.checked)} description="Users who have not signed in also get an identity.">
          Allow unauthenticated identities (guest access)
        </Checkbox>
        <FormField label="User pool - optional" description="Users who sign in to this user pool get an identity.">
          <Select
            selectedOption={userPool ? { value: userPool, label: poolLabel(userPool) } : { value: "", label: "No user pool" }}
            onChange={(e) => {
              setUserPool(e.detail.selectedOption.value ?? "");
              setClient("");
            }}
            options={[{ value: "", label: "No user pool" }, ...(userPools.data ?? []).map((p) => ({ value: p.Id, label: poolLabel(p.Id ?? "") }))]}
            statusType={userPools.loading ? "loading" : "finished"}
          />
        </FormField>
        {userPool && (
          <FormField label="App client">
            <Select
              selectedOption={client ? { value: client, label: clients.data?.find((c) => c.ClientId === client)?.ClientName ?? client, description: client } : null}
              onChange={(e) => setClient(e.detail.selectedOption.value ?? "")}
              options={(clients.data ?? []).map((c) => ({ value: c.ClientId, label: c.ClientName, description: c.ClientId }))}
              placeholder="Choose an app client"
              empty="This user pool has no app clients."
              statusType={clients.loading ? "loading" : "finished"}
            />
          </FormField>
        )}
      </FormModal>

      <ConfirmDelete visible={deleting} title={`Delete identity pool ${one?.IdentityPoolName ?? ""}`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Applications that use this identity pool can no longer get credentials." />
    </Shell>
  );
}
