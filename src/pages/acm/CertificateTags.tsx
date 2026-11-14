import { useState } from "react";
import { AddTagsToCertificateCommand, ListTagsForCertificateCommand, RemoveTagsFromCertificateCommand, type Tag } from "@aws-sdk/client-acm";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Table from "@cloudscape-design/components/table";
import { acm } from "../../clients/acm";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";

/** The tags of one certificate, with add and remove. */
export function CertificateTags({ arn }: { arn: string }) {
  const notify = useNotify();
  const tags = useLoad(async () => (await acm.send(new ListTagsForCertificateCommand({ CertificateArn: arn }))).Tags ?? [], [arn]);
  const form = useSubmit();
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const add = async () => {
    if (!key.trim()) return form.setError("Enter a tag key.");
    if (key.trim().toLowerCase().startsWith("aws:")) return form.setError("A tag key can't start with aws:.");
    const ok = await form.run(async () => {
      await acm.send(new AddTagsToCertificateCommand({ CertificateArn: arn, Tags: [{ Key: key.trim(), Value: value }] }));
      notify.success(`Tag ${key.trim()} added.`);
      tags.reload(true);
    });
    if (ok) setAdding(false);
  };

  const remove = async (tag: Tag) => {
    try {
      // Only the key is sent. With a value, ACM removes the tag only when the value matches too.
      await acm.send(new RemoveTagsFromCertificateCommand({ CertificateArn: arn, Tags: [{ Key: tag.Key }] }));
      notify.success(`Tag ${tag.Key} removed.`);
    } catch (e) {
      notify.error("Could not remove the tag", e);
    }
    tags.reload(true);
  };

  return (
    <>
      <Table
        header={
          <Header
            variant="h2"
            counter={`(${tags.data?.length ?? 0})`}
            actions={
              <Button
                onClick={() => {
                  setKey("");
                  setValue("");
                  form.setError("");
                  setAdding(true);
                }}
              >
                Add tag
              </Button>
            }
          >
            Tags
          </Header>
        }
        loading={tags.loading && !tags.data}
        loadingText="Loading tags"
        items={tags.data ?? []}
        columnDefinitions={[
          { id: "key", header: "Key", cell: (t) => t.Key, isRowHeader: true },
          { id: "value", header: "Value", cell: (t) => t.Value || "-" },
          {
            id: "actions",
            header: "Actions",
            cell: (t) => (
              <Button variant="inline-link" ariaLabel={`Remove tag ${t.Key}`} onClick={() => remove(t)}>
                Remove
              </Button>
            ),
          },
        ]}
        empty={<Box textAlign="center">{tags.error ?? "No tags"}</Box>}
      />

      <FormModal visible={adding} header="Add tag" submitLabel="Add tag" busy={form.busy} error={form.error} onDismiss={() => setAdding(false)} onSubmit={add}>
        <FormField label="Key">
          <Input value={key} placeholder="Environment" onChange={(e) => setKey(e.detail.value)} />
        </FormField>
        <FormField label="Value - optional">
          <Input value={value} onChange={(e) => setValue(e.detail.value)} />
        </FormField>
      </FormModal>
    </>
  );
}
