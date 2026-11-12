import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateAliasCommand, CreateKeyCommand, DisableKeyCommand, EnableKeyCommand, type KeySpec, type KeyUsageType } from "@aws-sdk/client-kms";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { kms } from "../../clients/kms";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { KEY_SPECS, type KeyRow, KeyState, USAGE_LABEL, listKeys } from "./kmsutil";

/** One page for both key lists. `manager` picks customer managed keys or the ones AWS services create. */
export default function Keys({ manager }: { manager: "CUSTOMER" | "AWS" }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(async () => (await listKeys()).filter((k) => (k.KeyManager ?? "CUSTOMER") === manager), [manager]);
  const form = useSubmit();
  const [selected, setSelected] = useState<KeyRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [spec, setSpec] = useState("SYMMETRIC_DEFAULT");
  const [usage, setUsage] = useState("ENCRYPT_DECRYPT");
  const [alias, setAlias] = useState("");
  const [description, setDescription] = useState("");
  const customer = manager === "CUSTOMER";
  const title = customer ? "Customer managed keys" : "AWS managed keys";
  const href = customer ? "/kms/keys" : "/kms/aws-keys";

  const openCreate = () => {
    setAlias("");
    setDescription("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (alias && !/^[a-zA-Z0-9/_-]+$/.test(alias)) return form.setError("Use letters, numbers and these characters in the alias: / _ -");
    const ok = await form.run(async () => {
      const res = await kms.send(new CreateKeyCommand({ Description: description || undefined, KeySpec: spec as KeySpec, KeyUsage: usage as KeyUsageType }));
      const id = res.KeyMetadata?.KeyId ?? "";
      if (alias) await kms.send(new CreateAliasCommand({ AliasName: `alias/${alias.replace(/^alias\//, "")}`, TargetKeyId: id }));
      notify.success(`Your KMS key was created with key ID ${id}.`);
      navigate(`/kms/keys/${id}`);
    });
    if (ok) setCreating(false);
  };

  const toggle = async (enable: boolean) => {
    try {
      for (const k of selected) await kms.send(enable ? new EnableKeyCommand({ KeyId: k.KeyId }) : new DisableKeyCommand({ KeyId: k.KeyId }));
      notify.success(`${enable ? "Enabled" : "Disabled"} ${selected.length} key${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not update the key", e);
    }
    list.reload();
  };

  return (
    <Shell service="kms" contentType="table" breadcrumbs={[{ text: "KMS", href: "/kms/keys" }, { text: title, href }]}>
      <ResourceTable
        title={title}
        resourceName="keys"
        filterPlaceholder="Filter keys by alias or key ID"
        emptyDescription={customer ? "A KMS key encrypts and decrypts data for your applications." : "AWS services create these keys the first time they need one."}
        emptyCli={customer ? "kms create-key --description my-app-key" : undefined}
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(k) => k.KeyId ?? ""}
        selectionType={customer ? "multi" : undefined}
        selected={selected}
        onSelect={setSelected}
        emptyAction={customer ? <Button onClick={openCreate}>Create key</Button> : undefined}
        actions={
          customer ? (
            <>
              <Button disabled={!selected.some((k) => k.KeyState === "Disabled")} onClick={() => toggle(true)}>
                Enable
              </Button>
              <Button disabled={!selected.some((k) => k.KeyState === "Enabled")} onClick={() => toggle(false)}>
                Disable
              </Button>
              <Button variant="primary" onClick={openCreate}>
                Create key
              </Button>
            </>
          ) : undefined
        }
        columns={[
          { id: "alias", header: "Aliases", cell: (k) => k.aliases.map((a) => a.replace(/^alias\//, "")).join(", ") || "-", sortingComparator: (a, b) => (a.aliases[0] ?? "").localeCompare(b.aliases[0] ?? ""), isRowHeader: true },
          { id: "id", header: "Key ID", cell: (k) => <RouterLink to={`/kms/keys/${k.KeyId}`}>{k.KeyId}</RouterLink>, sortingField: "KeyId" },
          { id: "status", header: "Status", cell: (k) => <KeyState state={k.KeyState} />, sortingField: "KeyState" },
          { id: "spec", header: "Key spec", cell: (k) => k.KeySpec ?? "-" },
          { id: "usage", header: "Key usage", cell: (k) => USAGE_LABEL[k.KeyUsage ?? ""] ?? k.KeyUsage ?? "-" },
          { id: "created", header: "Creation date", cell: (k) => formatDate(k.CreationDate) },
        ]}
      />

      <FormModal visible={creating} header="Create key" submitLabel="Create key" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Key spec" description="Symmetric keys fit most uses.">
          <Select
            selectedOption={{ value: spec, label: KEY_SPECS[spec].label }}
            onChange={(e) => {
              const next = e.detail.selectedOption.value ?? "SYMMETRIC_DEFAULT";
              setSpec(next);
              setUsage(KEY_SPECS[next].usages[0]);
            }}
            options={Object.entries(KEY_SPECS).map(([value, s]) => ({ value, label: s.label }))}
          />
        </FormField>
        <FormField label="Key usage">
          <Select selectedOption={{ value: usage, label: USAGE_LABEL[usage] }} onChange={(e) => setUsage(e.detail.selectedOption.value ?? usage)} options={KEY_SPECS[spec].usages.map((value) => ({ value, label: USAGE_LABEL[value] }))} />
        </FormField>
        <FormField label="Alias - optional" description="A display name for the key.">
          <Input value={alias} placeholder="my-app-key" onChange={(e) => setAlias(e.detail.value)} />
        </FormField>
        <FormField label="Description - optional">
          <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
      </FormModal>
    </Shell>
  );
}
