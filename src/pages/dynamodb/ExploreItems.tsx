import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DeleteItemCommand, GetItemCommand, QueryCommand, type QueryCommandOutput, ScanCommand, type ScanCommandOutput } from "@aws-sdk/client-dynamodb";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { dynamodb } from "../../clients/dynamodb";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { type FilterRow, type Item, type KeyAttr, type ReadInput, SORT_OPS, type SortOp, buildRead, cellText, keyOf, keyText } from "./dynamoutil";
import { type EditKind, ItemEditor } from "./ItemEditor";
import { ItemFilters } from "./ItemFilters";
import { describeTable, itemsHref, keyLabel, keysOf, listTableNames, tableHref } from "./tableutil";

type Mode = "scan" | "query";
type Result = { input: ReadInput; mode: Mode; items: Item[]; count: number; scanned: number; next?: Item };

const PAGE_SIZES = ["25", "50", "100", "300"].map((value) => ({ value, label: `${value} items` }));

export default function ExploreItems() {
  const [params, setParams] = useSearchParams();
  const name = params.get("table") ?? "";
  const notify = useNotify();
  const names = useLoad(listTableNames, []);
  const desc = useLoad(async () => (name ? describeTable(name) : undefined), [name]);
  // useLoad keeps the old table until the new one has loaded. Wait for the right one.
  const table = desc.data?.TableName === name ? desc.data : undefined;

  const [mode, setMode] = useState<Mode>("scan");
  const [index, setIndex] = useState("");
  const [pkValue, setPkValue] = useState("");
  const [skOp, setSkOp] = useState<SortOp>("=");
  const [skValue, setSkValue] = useState("");
  const [skValue2, setSkValue2] = useState("");
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [limit, setLimit] = useState("100");
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [selected, setSelected] = useState<Item[]>([]);
  const [editor, setEditor] = useState<{ kind: EditKind; item?: Item } | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const runId = useRef(0);

  const indexes = [...(table?.GlobalSecondaryIndexes ?? []), ...(table?.LocalSecondaryIndexes ?? [])];
  const tableKeys = keysOf(table?.KeySchema, table?.AttributeDefinitions);
  const keyList = [tableKeys.pk, tableKeys.sk].filter((k): k is KeyAttr => !!k);
  // The keys of what is read: the table, or the chosen index.
  const readKeys = index ? keysOf(indexes.find((i) => i.IndexName === index)?.KeySchema, table?.AttributeDefinitions) : tableKeys;
  const targets = [{ value: "", label: `Table - ${name}` }, ...indexes.map((i) => ({ value: i.IndexName ?? "", label: `Index - ${i.IndexName}` }))];

  /** Sends one request. With `prev`, it reads the next page and adds it to the items already shown. */
  const execute = async (input: ReadInput, kind: Mode, prev?: Result) => {
    const id = ++runId.current;
    setRunning(true);
    setRunError("");
    try {
      let res: ScanCommandOutput | QueryCommandOutput;
      if (kind === "scan") res = await dynamodb.send(new ScanCommand({ ...input, ExclusiveStartKey: prev?.next }));
      else res = await dynamodb.send(new QueryCommand({ ...input, ExclusiveStartKey: prev?.next }));
      if (id !== runId.current) return;
      setResult({
        input,
        mode: kind,
        items: [...(prev?.items ?? []), ...(res.Items ?? [])],
        count: (prev?.count ?? 0) + (res.Count ?? 0),
        scanned: (prev?.scanned ?? 0) + (res.ScannedCount ?? 0),
        next: res.LastEvaluatedKey,
      });
      if (!prev) setSelected([]);
    } catch (e) {
      if (id === runId.current) setRunError(errorMessage(e));
    }
    if (id === runId.current) setRunning(false);
  };

  const resetForm = () => {
    setMode("scan");
    setIndex("");
    setPkValue("");
    setSkOp("=");
    setSkValue("");
    setSkValue2("");
    setFilters([]);
    setRunError("");
  };

  // A newly opened table shows its first items straight away, as the AWS console does.
  useEffect(() => {
    runId.current++;
    setResult(undefined);
    setSelected([]);
    resetForm();
    if (table) execute({ TableName: name, Limit: Number(limit) }, "scan");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.TableName]);

  const run = () => {
    try {
      const input = buildRead({ table: name, index, mode, pk: readKeys.pk, pkValue, sk: readKeys.sk, skOp, skValue, skValue2, filters, limit: Number(limit) });
      execute(input, mode);
    } catch (e) {
      setRunError(errorMessage(e));
    }
  };

  /** Runs the last request again from its first page, after an item changed. */
  const rerun = () => {
    if (result) execute(result.input, result.mode);
  };

  // An index can hold only part of an item. So the editor always gets the whole item from the table.
  const openEditor = async (kind: EditKind, row?: Item) => {
    if (!row) return setEditor({ kind });
    try {
      const res = await dynamodb.send(new GetItemCommand({ TableName: name, Key: keyOf(row, keyList), ConsistentRead: true }));
      if (!res.Item) throw new Error("The item no longer exists. Run the scan or query again.");
      setEditor({ kind, item: res.Item });
    } catch (e) {
      notify.error("Could not load the item", e);
    }
  };

  const remove = async () => {
    try {
      for (const row of selected) await dynamodb.send(new DeleteItemCommand({ TableName: name, Key: keyOf(row, keyList) }));
      notify.success(selected.length === 1 ? "The item was deleted." : `${selected.length} items were deleted.`);
    } catch (e) {
      notify.error("Could not delete the item", e);
    }
    setDeleting(false);
    rerun();
  };

  // Columns: the keys of the table first, then the keys of the index, then every other attribute that was found.
  const items = result?.items ?? [];
  const columns = [...new Set([...keyList.map((k) => k.name), ...(result?.input.IndexName ? [readKeys.pk?.name, readKeys.sk?.name].filter((n): n is string => !!n) : []), ...items.flatMap((i) => Object.keys(i))])];
  const one = selected.length === 1 ? selected[0] : undefined;

  return (
    <Shell service="dynamodb" breadcrumbs={[{ text: "DynamoDB", href: "/dynamodb/tables" }, { text: "Explore items", href: "/dynamodb/items" }, ...(name ? [{ text: name, href: itemsHref(name) }] : [])]}>
      <ContentLayout header={<Header variant="h1" description={name ? <RouterLink to={tableHref(name)}>View table details</RouterLink> : "Choose a table to scan or query its items."}>Explore items</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Scan or query items</Header>}>
            <SpaceBetween size="l">
              <ColumnLayout columns={2}>
                <FormField label="Table" errorText={names.error || desc.error}>
                  <Select
                    selectedOption={name ? { value: name, label: name } : null}
                    options={(names.data ?? []).map((n) => ({ value: n, label: n }))}
                    onChange={(e) => setParams({ table: e.detail.selectedOption.value ?? "" }, { replace: true })}
                    statusType={names.loading ? "loading" : "finished"}
                    filteringType="auto"
                    placeholder="Choose a table"
                    empty="No tables"
                    ariaLabel="Table"
                  />
                </FormField>
                {table && (
                  <FormField label="Select a table or index">
                    <Select
                      selectedOption={targets.find((t) => t.value === index) ?? targets[0]}
                      options={targets}
                      ariaLabel="Select a table or index"
                      onChange={(e) => {
                        setIndex(e.detail.selectedOption.value ?? "");
                        setPkValue("");
                        setSkValue("");
                        setSkValue2("");
                      }}
                    />
                  </FormField>
                )}
              </ColumnLayout>
              {table && (
                <>
                  <SegmentedControl
                    selectedId={mode}
                    label="Scan or query"
                    onChange={(e) => setMode(e.detail.selectedId as Mode)}
                    options={[
                      { id: "scan", text: "Scan" },
                      { id: "query", text: "Query" },
                    ]}
                  />
                  {mode === "query" && (
                    <ColumnLayout columns={2}>
                      <FormField label={`${readKeys.pk?.name ?? ""} (Partition key)`} description={keyLabel(readKeys.pk)}>
                        <Input value={pkValue} placeholder="Enter partition key value" ariaLabel="Partition key value" onChange={(e) => setPkValue(e.detail.value)} />
                      </FormField>
                      {readKeys.sk && (
                        <FormField label={`${readKeys.sk.name} (Sort key) - optional`} description={keyLabel(readKeys.sk)}>
                          <SpaceBetween size="xs">
                            <Select selectedOption={SORT_OPS.find((o) => o.value === skOp) ?? SORT_OPS[0]} options={SORT_OPS} ariaLabel="Sort key condition" onChange={(e) => setSkOp(e.detail.selectedOption.value as SortOp)} />
                            <Input value={skValue} placeholder="Enter sort key value" ariaLabel="Sort key value" onChange={(e) => setSkValue(e.detail.value)} />
                            {skOp === "between" && <Input value={skValue2} placeholder="Enter the upper sort key value" ariaLabel="Upper sort key value" onChange={(e) => setSkValue2(e.detail.value)} />}
                          </SpaceBetween>
                        </FormField>
                      )}
                    </ColumnLayout>
                  )}
                  <ExpandableSection headerText={`Filters - optional (${filters.length})`} defaultExpanded={false}>
                    <ItemFilters filters={filters} onChange={setFilters} />
                  </ExpandableSection>
                  <FormField label="Items per request" description="How many items one request reads, before the filters apply.">
                    <div style={{ maxWidth: 200 }}>
                      <Select selectedOption={PAGE_SIZES.find((p) => p.value === limit) ?? PAGE_SIZES[2]} options={PAGE_SIZES} ariaLabel="Items per request" onChange={(e) => setLimit(e.detail.selectedOption.value ?? "100")} />
                    </div>
                  </FormField>
                  {runError && <Alert type="error">{runError}</Alert>}
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button variant="primary" loading={running} onClick={run}>
                      Run
                    </Button>
                    <Button onClick={resetForm}>Reset</Button>
                  </SpaceBetween>
                </>
              )}
            </SpaceBetween>
          </Container>

          {table && (
            <Table
              header={
                <Header
                  variant="h2"
                  counter={selected.length ? `(${selected.length}/${items.length})` : `(${items.length})`}
                  description={result ? `Items returned: ${result.count}. Items scanned: ${result.scanned}.${result.next ? " There are more items to read." : ""}` : undefined}
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button iconName="refresh" ariaLabel="Refresh" disabled={!result} loading={running} onClick={rerun} />
                      {result?.next && (
                        <Button loading={running} onClick={() => execute(result.input, result.mode, result)}>
                          Retrieve next page
                        </Button>
                      )}
                      <ButtonDropdown
                        disabled={!selected.length}
                        items={[
                          { id: "edit", text: "Edit item", disabled: !one },
                          { id: "duplicate", text: "Duplicate item", disabled: !one },
                          { id: "delete", text: "Delete items" },
                        ]}
                        onItemClick={(e) => {
                          if (e.detail.id === "delete") setDeleting(true);
                          else openEditor(e.detail.id as EditKind, one);
                        }}
                      >
                        Actions
                      </ButtonDropdown>
                      <Button variant="primary" onClick={() => openEditor("create")}>
                        Create item
                      </Button>
                    </SpaceBetween>
                  }
                >
                  Items returned
                </Header>
              }
              loading={running && !result}
              loadingText="Loading items"
              items={items}
              trackBy={(i) => keyText(i, keyList)}
              selectionType="multi"
              selectedItems={selected}
              onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
              resizableColumns
              columnDefinitions={columns.map((attr, n) => ({
                id: attr,
                header: keyList.some((k) => k.name === attr) ? `${attr} (${attr === tableKeys.pk?.name ? "Partition key" : "Sort key"})` : attr,
                minWidth: 140,
                isRowHeader: n === 0,
                cell: (i: Item) =>
                  n === 0 ? (
                    <Button variant="inline-link" onClick={() => openEditor("edit", i)}>
                      {cellText(i[attr])}
                    </Button>
                  ) : (
                    cellText(i[attr])
                  ),
              }))}
              empty={
                <Box textAlign="center" color="inherit" margin={{ vertical: "l" }}>
                  <b>No items</b>
                  <Box variant="p" color="inherit">
                    {result?.next ? "This page has no matching items. Retrieve the next page to read on." : result ? "The scan or query did not return any items." : "Run a scan or query to see items."}
                  </Box>
                </Box>
              }
            />
          )}
        </SpaceBetween>
      </ContentLayout>

      {editor && table && (
        <ItemEditor
          table={name}
          keys={keyList}
          kind={editor.kind}
          item={editor.item}
          onClose={() => setEditor(undefined)}
          onSaved={(message) => {
            setEditor(undefined);
            notify.success(message);
            // With no result yet, a first scan shows the new item.
            if (result) rerun();
            else execute({ TableName: name, Limit: Number(limit) }, "scan");
          }}
        />
      )}

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? "Delete item" : "Delete items"} onCancel={() => setDeleting(false)} onConfirm={remove}>
        Delete {selected.length === 1 ? "the selected item" : `the ${selected.length} selected items`}? You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
