import { useState } from "react";
import { AddTagsCommand, ListTagsCommand, RemoveTagsCommand, type Tag } from "@aws-sdk/client-opensearch";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { opensearch } from "../../clients/opensearch";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";

/** The tags of one domain: list, add and remove. */
export function DomainTags({ arn }: { arn: string }) {
  const notify = useNotify();
  const tags = useLoad(async () => (await opensearch.send(new ListTagsCommand({ ARN: arn }))).TagList ?? [], [arn]);
  const form = useSubmit();
  const [selected, setSelected] = useState<Tag[]>([]);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const openAdd = () => {
    setKey("");
    setValue("");
    form.setError("");
    setAdding(true);
  };

  const add = async () => {
    if (!key.trim() || key.length > 128) return form.setError("Enter a key of 1 to 128 characters.");
    if (value.length > 256) return form.setError("Use a value of up to 256 characters.");
    const ok = await form.run(async () => {
      await opensearch.send(new AddTagsCommand({ ARN: arn, TagList: [{ Key: key.trim(), Value: value }] }));
      notify.success(`Tag ${key.trim()} was added.`);
      tags.reload(true);
    });
    if (ok) setAdding(false);
  };

  const remove = async () => {
    try {
      await opensearch.send(new RemoveTagsCommand({ ARN: arn, TagKeys: selected.map((t) => t.Key ?? "") }));
      notify.success(selected.length === 1 ? `Tag ${selected[0].Key} was removed.` : `Removed ${selected.length} tags.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not remove the tag", e);
    }
    tags.reload(true);
  };

  return (
    <>
      <ResourceTable
        title="Tags"
        resourceName="tags"
        variant="container"
        stickyHeader={false}
        global
        items={tags.data}
        loading={tags.loading}
        error={tags.error}
        trackBy={(t) => t.Key ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openAdd}>Add tag</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={remove}>
              Remove
            </Button>
            <Button onClick={openAdd}>Add tag</Button>
          </>
        }
        columns={[
          { id: "key", header: "Key", cell: (t) => t.Key, sortingField: "Key", isRowHeader: true },
          { id: "value", header: "Value", cell: (t) => t.Value || "-", sortingField: "Value" },
        ]}
      />

      <FormModal visible={adding} header="Add tag" submitLabel="Add tag" busy={form.busy} error={form.error} onDismiss={() => setAdding(false)} onSubmit={add}>
        <FormField label="Key">
          <Input value={key} placeholder="env" onChange={(e) => setKey(e.detail.value)} />
        </FormField>
        <FormField label="Value - optional">
          <Input value={value} placeholder="dev" onChange={(e) => setValue(e.detail.value)} />
        </FormField>
      </FormModal>
    </>
  );
}
