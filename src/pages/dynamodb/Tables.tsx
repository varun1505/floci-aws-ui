import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteTableCommand, type TableDescription } from "@aws-sdk/client-dynamodb";
import Button from "@cloudscape-design/components/button";
import { dynamodb } from "../../clients/dynamodb";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatBytes } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { TableStatus, isOnDemand, itemsHref, keyLabel, keysOf, listTables, tableHref } from "./tableutil";

const indexCount = (t: TableDescription) => (t.GlobalSecondaryIndexes?.length ?? 0) + (t.LocalSecondaryIndexes?.length ?? 0);

export default function Tables() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listTables, []);
  const [selected, setSelected] = useState<TableDescription[]>([]);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    const names = selected.map((t) => t.TableName ?? "");
    try {
      for (const TableName of names) await dynamodb.send(new DeleteTableCommand({ TableName }));
      notify.success(names.length === 1 ? `The table ${names[0]} was deleted.` : `${names.length} tables were deleted.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the table", e);
    }
    setDeleting(false);
    list.reload();
  };

  const create = () => navigate("/dynamodb/tables/create");

  return (
    <Shell service="dynamodb" contentType="table" breadcrumbs={[{ text: "DynamoDB", href: "/dynamodb/tables" }, { text: "Tables", href: "/dynamodb/tables" }]}>
      <ResourceTable
        title="Tables"
        resourceName="tables"
        filterPlaceholder="Find tables"
        emptyDescription="A table stores items. Each item is found by its key."
        emptyCli="dynamodb create-table --table-name my-table --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(t) => t.TableName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={create}>Create table</Button>}
        actions={
          <>
            <Button disabled={selected.length !== 1} onClick={() => navigate(itemsHref(selected[0].TableName ?? ""))}>
              Explore items
            </Button>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={create}>
              Create table
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (t) => <RouterLink to={tableHref(t.TableName ?? "")}>{t.TableName}</RouterLink>, sortingField: "TableName", isRowHeader: true },
          { id: "status", header: "Status", cell: (t) => <TableStatus status={t.TableStatus} />, sortingField: "TableStatus" },
          { id: "pk", header: "Partition key", cell: (t) => keyLabel(keysOf(t.KeySchema, t.AttributeDefinitions).pk) },
          { id: "sk", header: "Sort key", cell: (t) => keyLabel(keysOf(t.KeySchema, t.AttributeDefinitions).sk) },
          { id: "indexes", header: "Indexes", cell: indexCount, sortingComparator: (a, b) => indexCount(a) - indexCount(b) },
          { id: "capacity", header: "Capacity mode", cell: (t) => (isOnDemand(t) ? "On-demand" : "Provisioned") },
          { id: "items", header: "Item count", cell: (t) => t.ItemCount ?? 0, sortingField: "ItemCount" },
          { id: "size", header: "Total size", cell: (t) => formatBytes(t.TableSizeBytes ?? 0), sortingField: "TableSizeBytes" },
        ]}
      />

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? "Delete table" : "Delete tables"} confirmText="confirm" onCancel={() => setDeleting(false)} onConfirm={remove}>
        Delete {selected.length === 1 ? <b>{selected[0].TableName}</b> : `${selected.length} tables`} and every item in {selected.length === 1 ? "it" : "them"}? You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
