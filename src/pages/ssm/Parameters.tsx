import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteParameterCommand, DescribeParametersCommand, type ParameterMetadata, PutParameterCommand, type ParameterType } from "@aws-sdk/client-ssm";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Textarea from "@cloudscape-design/components/textarea";
import { ssm } from "../../clients/ssm";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";

export const parameterHref = (name: string) => `/ssm/parameter?name=${encodeURIComponent(name)}`;

export const PARAMETER_TYPES = [
  { value: "String", label: "String", description: "Any string value." },
  { value: "StringList", label: "StringList", description: "Separate strings using commas." },
  { value: "SecureString", label: "SecureString", description: "Encrypt sensitive data using KMS keys." },
];

export async function listParameters(): Promise<ParameterMetadata[]> {
  const out: ParameterMetadata[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ssm.send(new DescribeParametersCommand({ NextToken, MaxResults: 50 }));
    out.push(...(res.Parameters ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
}

export default function Parameters() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listParameters, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<ParameterMetadata[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("String");
  const [value, setValue] = useState("");

  const openCreate = () => {
    setName("");
    setDescription("");
    setValue("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[a-zA-Z0-9_.\-/]+$/.test(name)) return form.setError("Use letters, numbers and these characters in the name: _ . - /");
    if (!value) return form.setError("Value is required.");
    const ok = await form.run(async () => {
      await ssm.send(new PutParameterCommand({ Name: name, Description: description || undefined, Type: type as ParameterType, Value: value }));
      notify.success(`Create parameter request succeeded for ${name}.`);
      navigate(parameterHref(name));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const p of selected) await ssm.send(new DeleteParameterCommand({ Name: p.Name }));
      notify.success(`Deleted ${selected.length} parameter${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the parameter", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="ssm" contentType="table" breadcrumbs={[{ text: "Systems Manager", href: "/ssm/parameters" }, { text: "Parameter Store", href: "/ssm/parameters" }]}>
      <ResourceTable
        title="My parameters"
        resourceName="parameters"
        filterPlaceholder="Search parameters"
        emptyDescription="A parameter holds one configuration value, such as a URL, a feature flag or a password."
        emptyCli="ssm put-parameter --name /my-app/dev/db-url --type String --value postgres://db:5432/app"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(p) => p.Name ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create parameter</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create parameter
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (p) => <RouterLink to={parameterHref(p.Name ?? "")}>{p.Name}</RouterLink>, sortingField: "Name", isRowHeader: true },
          { id: "tier", header: "Tier", cell: (p) => p.Tier ?? "Standard" },
          { id: "type", header: "Type", cell: (p) => p.Type ?? "-", sortingField: "Type" },
          { id: "modified", header: "Last modified", cell: (p) => formatDate(p.LastModifiedDate), sortingComparator: (a, b) => (a.LastModifiedDate?.getTime() ?? 0) - (b.LastModifiedDate?.getTime() ?? 0) },
          { id: "version", header: "Version", cell: (p) => p.Version ?? "-" },
          { id: "description", header: "Description", cell: (p) => p.Description || "-" },
        ]}
      />

      <FormModal visible={creating} size="large" header="Create parameter" submitLabel="Create parameter" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Name" constraintText="Use a path to group parameters, such as /my-app/dev/db-url.">
          <Input value={name} placeholder="/my-app/dev/db-url" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Description - optional">
          <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
        <FormField label="Type">
          <RadioGroup value={type} onChange={(e) => setType(e.detail.value)} items={PARAMETER_TYPES} />
        </FormField>
        <FormField label="Value" stretch>
          <Textarea value={value} rows={4} onChange={(e) => setValue(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting}
        title={selected.length === 1 ? `Delete ${selected[0].Name}` : `Delete ${selected.length} parameters`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Applications that read a deleted parameter will fail."
      />
    </Shell>
  );
}
