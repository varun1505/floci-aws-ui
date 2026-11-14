import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CreateUserPoolDomainCommand, DeleteUserPoolDomainCommand, DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
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
import Tabs from "@cloudscape-design/components/tabs";
import { cognito } from "../../clients/cognito";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { PROXY_BASE } from "../../config";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { ClientsTab } from "./ClientsTab";
import { deletePool, listClients, listGroups, listUsers, policyLines, poolHref } from "./cognitoutil";
import { GroupsTab } from "./GroupsTab";
import { UsersTab } from "./UsersTab";

const MFA: Record<string, string> = { OFF: "No MFA", OPTIONAL: "Optional MFA", ON: "Require MFA" };

export default function UserPoolDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const pool = useLoad(async () => (await cognito.send(new DescribeUserPoolCommand({ UserPoolId: id }))).UserPool, [id]);
  const users = useLoad(() => listUsers(id), [id]);
  const groups = useLoad(() => listGroups(id), [id]);
  const clients = useLoad(() => listClients(id), [id]);
  // The emulator serves the issuer and the signing keys of each pool. Applications check tokens against them.
  const discovery = useLoad(async () => {
    const res = await fetch(`${PROXY_BASE}/${id}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { issuer?: string; jwks_uri?: string };
  }, [id]);
  const form = useSubmit();
  const [modal, setModal] = useState<"domain" | "delete" | undefined>(undefined);
  const [domain, setDomain] = useState("");

  const p = pool.data;
  const currentDomain = p?.CustomDomain ?? p?.Domain;
  const refresh = () => (pool.reload(), users.reload(), groups.reload(), clients.reload());

  const createDomain = async () => {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) return form.setError("Use up to 63 lowercase letters, numbers and hyphens. Start and end with a letter or a number.");
    const ok = await form.run(async () => {
      await cognito.send(new CreateUserPoolDomainCommand({ UserPoolId: id, Domain: domain }));
      notify.success(`Domain ${domain} was created.`);
      pool.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const deleteDomain = async () => {
    try {
      await cognito.send(new DeleteUserPoolDomainCommand({ UserPoolId: id, Domain: currentDomain }));
      notify.success(`Domain ${currentDomain} was deleted.`);
    } catch (e) {
      notify.error("Could not delete the domain", e);
    }
    pool.reload(true);
  };

  const remove = async () => {
    try {
      await deletePool(id);
      notify.success(`User pool ${p?.Name ?? id} was deleted.`);
      navigate("/cognito/user-pools");
    } catch (e) {
      notify.error("Could not delete the user pool", e);
      setModal(undefined);
    }
  };

  return (
    <Shell
      service="cognito"
      breadcrumbs={[
        { text: "Amazon Cognito", href: "/cognito/user-pools" },
        { text: "User pools", href: "/cognito/user-pools" },
        { text: p?.Name ?? id, href: poolHref(id) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={refresh} />
                <Button disabled={!p} onClick={() => setModal("delete")}>
                  Delete user pool
                </Button>
              </SpaceBetween>
            }
          >
            {p?.Name ?? id}
          </Header>
        }
      >
        {pool.error ? (
          <Alert type="error" header="Could not load the user pool">
            {pool.error}
          </Alert>
        ) : !p ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">User pool overview</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="User pool name">{p.Name}</Pair>
                <Pair label="User pool ID">
                  <Copy text={p.Id} />
                </Pair>
                <Pair label="ARN">
                  <Copy text={p.Arn} />
                </Pair>
                <Pair label="Estimated number of users">{users.data ? String(users.data.length) : undefined}</Pair>
                <Pair label="Created time">{formatDate(p.CreationDate)}</Pair>
                <Pair label="Last updated time">{formatDate(p.LastModifiedDate)}</Pair>
                <Pair label="Token signing key URL">
                  <Copy text={discovery.data?.jwks_uri} />
                </Pair>
                <Pair label="Issuer URL">
                  <Copy text={discovery.data?.issuer} />
                </Pair>
                <Pair label="Deletion protection">{p.DeletionProtection === "ACTIVE" ? "Active" : "Inactive"}</Pair>
              </ColumnLayout>
            </Container>
            <Container
              header={
                <Header
                  variant="h2"
                  actions={
                    currentDomain ? (
                      <Button onClick={deleteDomain}>Delete domain</Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setDomain("");
                          form.setError("");
                          setModal("domain");
                        }}
                      >
                        Create domain
                      </Button>
                    )
                  }
                >
                  Sign-in
                </Header>
              }
            >
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Sign-in option">{p.UsernameAttributes?.includes("email") ? "Email" : "User name"}</Pair>
                <Pair label="Multi-factor authentication">{MFA[p.MfaConfiguration ?? "OFF"] ?? p.MfaConfiguration}</Pair>
                <Pair label="Attributes verified automatically">{p.AutoVerifiedAttributes?.join(", ")}</Pair>
                <Pair label="Password policy">
                  {policyLines(p.Policies?.PasswordPolicy).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </Pair>
                <Pair label="Temporary passwords expire in">{p.Policies?.PasswordPolicy?.TemporaryPasswordValidityDays !== undefined ? `${p.Policies.PasswordPolicy.TemporaryPasswordValidityDays} days` : undefined}</Pair>
                <Pair label="Domain">{currentDomain}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                { id: "users", label: "Users", content: <UsersTab pool={p} users={users} /> },
                { id: "groups", label: "Groups", content: <GroupsTab poolId={id} groups={groups} /> },
                { id: "clients", label: "App clients", content: <ClientsTab poolId={id} clients={clients} /> },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={modal === "domain"} header="Create domain" submitLabel="Create domain" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={createDomain}>
        <FormField label="Domain prefix" description="The name of the sign-in pages of this user pool.">
          <Input value={domain} placeholder="my-app" onChange={(e) => setDomain(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={modal === "delete"}
        title={`Delete user pool ${p?.Name ?? id}`}
        onCancel={() => setModal(undefined)}
        onConfirm={remove}
        warning="This deletes the users, groups, app clients and the domain of the user pool. You can't undo it."
      />
    </Shell>
  );
}
