import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteSecretCommand, ListSecretsCommand, type SecretListEntry } from "@aws-sdk/client-secrets-manager";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import { secrets } from "../../clients/secrets";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

export const secretHref = (name: string) => `/secretsmanager/secret?name=${encodeURIComponent(name)}`;

export async function listAllSecrets(): Promise<SecretListEntry[]> {
  const out: SecretListEntry[] = [];
  let NextToken: string | undefined;
  do {
    const res = await secrets.send(new ListSecretsCommand({ NextToken }));
    out.push(...(res.SecretList ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export default function Secrets() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listAllSecrets, []);
  const [selected, setSelected] = useState<SecretListEntry[]>([]);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    try {
      for (const s of selected) await secrets.send(new DeleteSecretCommand({ SecretId: s.ARN ?? s.Name, ForceDeleteWithoutRecovery: true }));
      notify.success(`Deleted ${selected.length} secret${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the secret", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell
      service="secretsmanager"
      contentType="table"
      breadcrumbs={[{ text: "Secrets Manager", href: "/secretsmanager/secrets" }, { text: "Secrets", href: "/secretsmanager/secrets" }]}
    >
      <ResourceTable
        title="Secrets"
        resourceName="secrets"
        filterPlaceholder="Filter secrets by name, description or tag"
        emptyDescription="A secret holds credentials or keys that your applications read at run time."
        emptyCli={`secretsmanager create-secret --name my-app/db --secret-string '{"username":"admin","password":"change-me"}'`}
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(s) => s.ARN ?? s.Name ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => navigate("/secretsmanager/secrets/create")}>Store a new secret</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => navigate("/secretsmanager/secrets/create")}>
              Store a new secret
            </Button>
          </>
        }
        columns={[
          {
            id: "name",
            header: "Secret name",
            cell: (s) => <RouterLink to={secretHref(s.Name ?? "")}>{s.Name}</RouterLink>,
            sortingField: "Name",
            isRowHeader: true,
          },
          { id: "description", header: "Description", cell: (s) => s.Description || "-" },
          { id: "retrieved", header: "Last retrieved (UTC)", cell: (s) => formatDate(s.LastAccessedDate) },
          { id: "changed", header: "Last changed", cell: (s) => formatDate(s.LastChangedDate) },
          { id: "created", header: "Created on", cell: (s) => formatDate(s.CreatedDate) },
        ]}
      />
      <ConfirmDelete
        visible={deleting}
        title={`Delete secret${selected.length === 1 ? "" : "s"}`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="The secrets are deleted immediately, with no recovery window. Applications that read them will start to fail."
      >
        <Box>{selected.map((s) => s.Name).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
