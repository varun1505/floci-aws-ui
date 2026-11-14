import { useState } from "react";
import { type GlobalSecondaryIndexDescription, type TableDescription, UpdateTableCommand } from "@aws-sdk/client-dynamodb";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { dynamodb } from "../../clients/dynamodb";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { type IndexDraft, IndexFields, TableStatus, addDefinitions, indexAttributes, indexError, indexRequest, isOnDemand, keyLabel, keysOf, newIndex, projectionLabel } from "./tableutil";

/** The Indexes tab of a table: global indexes (create and delete) and local indexes (read only). */
export function TableIndexes({ table, onChange }: { table: TableDescription; onChange: () => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const [draft, setDraft] = useState<IndexDraft | undefined>(undefined);
  const [selected, setSelected] = useState<GlobalSecondaryIndexDescription[]>([]);
  const [deleting, setDeleting] = useState(false);
  const TableName = table.TableName ?? "";
  const globals = table.GlobalSecondaryIndexes ?? [];
  const locals = table.LocalSecondaryIndexes ?? [];

  const create = async () => {
    if (!draft) return;
    const problem = indexError(draft);
    if (problem) return form.setError(problem);
    if ([...globals, ...locals].some((i) => i.IndexName === draft.name)) return form.setError(`This table already has an index named ${draft.name}.`);
    const attrs = indexAttributes(draft);
    try {
      // Checks that a key attribute keeps the type it already has in the table.
      addDefinitions(table.AttributeDefinitions ?? [], attrs);
    } catch (e) {
      return form.setError(e instanceof Error ? e.message : String(e));
    }
    const ok = await form.run(async () => {
      const throughput = isOnDemand(table) ? undefined : { ReadCapacityUnits: table.ProvisionedThroughput?.ReadCapacityUnits ?? 5, WriteCapacityUnits: table.ProvisionedThroughput?.WriteCapacityUnits ?? 5 };
      await dynamodb.send(
        new UpdateTableCommand({
          TableName,
          AttributeDefinitions: addDefinitions([], attrs),
          GlobalSecondaryIndexUpdates: [{ Create: { ...indexRequest(draft, ""), ProvisionedThroughput: throughput } }],
        }),
      );
      notify.success(`The index ${draft.name} was created.`);
      onChange();
    });
    if (ok) setDraft(undefined);
  };

  const remove = async () => {
    const IndexName = selected[0]?.IndexName ?? "";
    try {
      await dynamodb.send(new UpdateTableCommand({ TableName, GlobalSecondaryIndexUpdates: [{ Delete: { IndexName } }] }));
      notify.success(`The index ${IndexName} was deleted.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the index", e);
    }
    setDeleting(false);
    onChange();
  };

  return (
    <SpaceBetween size="l">
      <Table
        header={
          <Header
            variant="h2"
            counter={`(${globals.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={selected.length !== 1} onClick={() => setDeleting(true)}>
                  Delete
                </Button>
                <Button
                  onClick={() => {
                    form.setError("");
                    setDraft(newIndex("GLOBAL"));
                  }}
                >
                  Create index
                </Button>
              </SpaceBetween>
            }
          >
            Global secondary indexes
          </Header>
        }
        selectionType="single"
        selectedItems={selected}
        onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
        trackBy={(i) => i.IndexName ?? ""}
        items={globals}
        columnDefinitions={[
          { id: "name", header: "Name", cell: (i) => i.IndexName, isRowHeader: true },
          { id: "status", header: "Status", cell: (i) => <TableStatus status={i.IndexStatus} /> },
          { id: "pk", header: "Partition key", cell: (i) => keyLabel(keysOf(i.KeySchema, table.AttributeDefinitions).pk) },
          { id: "sk", header: "Sort key", cell: (i) => keyLabel(keysOf(i.KeySchema, table.AttributeDefinitions).sk) },
          { id: "projection", header: "Projected attributes", cell: (i) => projectionLabel(i.Projection) },
          { id: "items", header: "Item count", cell: (i) => i.ItemCount ?? 0 },
        ]}
        empty={<Box textAlign="center">No global secondary indexes</Box>}
      />
      <Table
        header={
          <Header variant="h2" counter={`(${locals.length})`} description="A local secondary index can only be created together with the table.">
            Local secondary indexes
          </Header>
        }
        items={locals}
        columnDefinitions={[
          { id: "name", header: "Name", cell: (i) => i.IndexName, isRowHeader: true },
          { id: "pk", header: "Partition key", cell: (i) => keyLabel(keysOf(i.KeySchema, table.AttributeDefinitions).pk) },
          { id: "sk", header: "Sort key", cell: (i) => keyLabel(keysOf(i.KeySchema, table.AttributeDefinitions).sk) },
          { id: "projection", header: "Projected attributes", cell: (i) => projectionLabel(i.Projection) },
          { id: "items", header: "Item count", cell: (i) => i.ItemCount ?? 0 },
        ]}
        empty={<Box textAlign="center">No local secondary indexes</Box>}
      />

      <FormModal visible={!!draft} header="Create global secondary index" submitLabel="Create index" busy={form.busy} error={form.error} onDismiss={() => setDraft(undefined)} onSubmit={create}>
        {draft && <IndexFields draft={draft} onChange={setDraft} />}
      </FormModal>

      <ConfirmDelete visible={deleting} title="Delete index" onCancel={() => setDeleting(false)} onConfirm={remove}>
        Delete the index <b>{selected[0]?.IndexName}</b>? Queries that use it will fail.
      </ConfirmDelete>
    </SpaceBetween>
  );
}
