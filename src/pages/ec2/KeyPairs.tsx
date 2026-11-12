import { useState } from "react";
import { CreateKeyPairCommand, DeleteKeyPairCommand, DescribeKeyPairsCommand, type KeyPairInfo, type KeyType } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { download, errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

export default function KeyPairs() {
  const notify = useNotify();
  const keys = useLoad(async () => (await ec2.send(new DescribeKeyPairsCommand({}))).KeyPairs ?? [], []);
  const [selected, setSelected] = useState<KeyPairInfo[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("rsa");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name) return setError("Key pair name is required.");
    setBusy(true);
    try {
      const res = await ec2.send(new CreateKeyPairCommand({ KeyName: name, KeyType: type as KeyType }));
      // The private key is returned only once. Save it to the user's machine now.
      if (res.KeyMaterial) download(res.KeyMaterial, `${name}.pem`, "application/x-pem-file");
      notify.success(`Successfully created key pair ${name}. The private key file was downloaded.`);
      setCreating(false);
      setName("");
      keys.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      for (const k of selected) await ec2.send(new DeleteKeyPairCommand({ KeyName: k.KeyName }));
      notify.success(`Deleted ${selected.length} key pair${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the key pair", e);
    }
    setDeleting(false);
    keys.reload();
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/instances" }, { text: "Key pairs", href: "/ec2/key-pairs" }]}>
      <ResourceTable
        title="Key pairs"
        resourceName="key pairs"
        filterPlaceholder="Find key pair by attribute or tag"
        items={keys.data}
        loading={keys.loading}
        error={keys.error}
        onRefresh={() => keys.reload()}
        trackBy={(k) => k.KeyName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => setCreating(true)}>Create key pair</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create key pair
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (k) => k.KeyName, sortingField: "KeyName", isRowHeader: true },
          { id: "type", header: "Type", cell: (k) => k.KeyType ?? "-" },
          { id: "created", header: "Created", cell: (k) => formatDate(k.CreateTime) },
          { id: "fingerprint", header: "Fingerprint", cell: (k) => k.KeyFingerprint ?? "-" },
          { id: "id", header: "ID", cell: (k) => k.KeyPairId ?? "-" },
        ]}
      />
      <Modal
        visible={creating}
        onDismiss={() => setCreating(false)}
        header="Create key pair"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create key pair
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Name" constraintText="The name can include up to 255 ASCII characters." errorText={error}>
            <Input
              value={name}
              placeholder="Enter key pair name"
              autoFocus
              onChange={(e) => {
                setName(e.detail.value);
                setError("");
              }}
            />
          </FormField>
          <FormField label="Key pair type">
            <RadioGroup
              value={type}
              onChange={(e) => setType(e.detail.value)}
              items={[
                { value: "rsa", label: "RSA" },
                { value: "ed25519", label: "ED25519" },
              ]}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      <ConfirmDelete visible={deleting} title="Delete key pairs" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>{selected.map((k) => k.KeyName).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
