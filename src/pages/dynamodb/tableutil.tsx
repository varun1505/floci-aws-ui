import {
  type AttributeDefinition,
  DescribeTableCommand,
  type KeySchemaElement,
  ListTablesCommand,
  type Projection,
  type ScalarAttributeType,
  type TableDescription,
} from "@aws-sdk/client-dynamodb";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { dynamodb } from "../../clients/dynamodb";
import type { KeyAttr } from "./dynamoutil";

export const tableHref = (name: string) => `/dynamodb/table?name=${encodeURIComponent(name)}`;
export const itemsHref = (name: string) => `/dynamodb/items?table=${encodeURIComponent(name)}`;

export async function listTableNames(): Promise<string[]> {
  const names: string[] = [];
  let start: string | undefined;
  do {
    const res = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName: start, Limit: 100 }));
    names.push(...(res.TableNames ?? []));
    start = res.LastEvaluatedTableName;
  } while (start);
  return names;
}

/** Every table with its details. DynamoDB lists only names, so each table needs one more call. */
export async function listTables(): Promise<TableDescription[]> {
  const names = await listTableNames();
  const tables = await Promise.all(names.map((TableName) => dynamodb.send(new DescribeTableCommand({ TableName })).then((r) => r.Table)));
  return tables.filter((t): t is TableDescription => !!t);
}

export const describeTable = async (TableName: string) => (await dynamodb.send(new DescribeTableCommand({ TableName }))).Table;

export const KEY_TYPES = [
  { value: "S", label: "String" },
  { value: "N", label: "Number" },
  { value: "B", label: "Binary" },
];
const TYPE_LABEL: Record<string, string> = { S: "String", N: "Number", B: "Binary" };

/** The partition key and sort key of a table or an index, with their types. */
export function keysOf(schema: KeySchemaElement[] | undefined, defs: AttributeDefinition[] | undefined): { pk?: KeyAttr; sk?: KeyAttr } {
  const find = (kind: string): KeyAttr | undefined => {
    const name = schema?.find((k) => k.KeyType === kind)?.AttributeName;
    return name ? { name, type: defs?.find((d) => d.AttributeName === name)?.AttributeType ?? "S" } : undefined;
  };
  return { pk: find("HASH"), sk: find("RANGE") };
}

export const keyLabel = (k?: KeyAttr) => (k ? `${k.name} (${TYPE_LABEL[k.type] ?? k.type})` : "-");

export const isOnDemand = (t?: TableDescription) => t?.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST";
export const capacityLabel = (t?: TableDescription) => (isOnDemand(t) ? "On-demand" : `Provisioned (${t?.ProvisionedThroughput?.ReadCapacityUnits ?? 0} read, ${t?.ProvisionedThroughput?.WriteCapacityUnits ?? 0} write)`);

export function projectionLabel(p?: Projection): string {
  if (p?.ProjectionType === "KEYS_ONLY") return "Keys only";
  if (p?.ProjectionType === "INCLUDE") return `Include (${(p.NonKeyAttributes ?? []).join(", ")})`;
  return "All";
}

const STATUS: Record<string, StatusIndicatorProps.Type> = { ACTIVE: "success", CREATING: "in-progress", UPDATING: "in-progress", DELETING: "in-progress", ARCHIVED: "stopped", ARCHIVING: "in-progress", INACCESSIBLE_ENCRYPTION_CREDENTIALS: "error" };

export function TableStatus({ status }: { status?: string }) {
  if (!status) return <>-</>;
  return <StatusIndicator type={STATUS[status] ?? "info"}>{status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")}</StatusIndicator>;
}

export const NAME_RULE = /^[a-zA-Z0-9_.-]{3,255}$/;
export const NAME_HINT = "Between 3 and 255 characters. Only letters, numbers, underscores (_), hyphens (-) and periods (.).";

// ---- Secondary index forms

export type IndexDraft = { kind: "GLOBAL" | "LOCAL"; name: string; pk: string; pkType: string; sk: string; skType: string; projection: string; include: string };
export const newIndex = (kind: IndexDraft["kind"]): IndexDraft => ({ kind, name: "", pk: "", pkType: "S", sk: "", skType: "S", projection: "ALL", include: "" });

const PROJECTIONS = [
  { value: "ALL", label: "All" },
  { value: "KEYS_ONLY", label: "Only keys" },
  { value: "INCLUDE", label: "Include" },
];

const includeList = (d: IndexDraft) => d.include.split(",").map((s) => s.trim()).filter(Boolean);

/** What is wrong with an index form, or an empty text. A local index uses the partition key of the table. */
export function indexError(d: IndexDraft): string {
  if (!NAME_RULE.test(d.name)) return `Index name: ${NAME_HINT}`;
  if (d.kind === "GLOBAL" && !d.pk.trim()) return `Enter a partition key for the index ${d.name}.`;
  if (d.kind === "LOCAL" && !d.sk.trim()) return `Enter a sort key for the local index ${d.name}.`;
  if (d.projection === "INCLUDE" && !includeList(d).length) return `Enter the attributes to include in the index ${d.name}.`;
  return "";
}

/** The index part of a CreateTable or UpdateTable request. `tablePk` is used by local indexes. */
export function indexRequest(d: IndexDraft, tablePk: string) {
  const KeySchema: KeySchemaElement[] = [{ AttributeName: d.kind === "LOCAL" ? tablePk : d.pk.trim(), KeyType: "HASH" }];
  if (d.sk.trim()) KeySchema.push({ AttributeName: d.sk.trim(), KeyType: "RANGE" });
  const projection: Projection = d.projection === "INCLUDE" ? { ProjectionType: "INCLUDE", NonKeyAttributes: includeList(d) } : { ProjectionType: d.projection === "KEYS_ONLY" ? "KEYS_ONLY" : "ALL" };
  return { IndexName: d.name, KeySchema, Projection: projection };
}

/** The key attributes an index adds, with their types. */
export function indexAttributes(d: IndexDraft): KeyAttr[] {
  const out: KeyAttr[] = [];
  if (d.kind === "GLOBAL" && d.pk.trim()) out.push({ name: d.pk.trim(), type: d.pkType });
  if (d.sk.trim()) out.push({ name: d.sk.trim(), type: d.skType });
  return out;
}

/** Adds key attributes to a list of definitions. One attribute can have only one type, so a clash is an error. */
export function addDefinitions(defs: AttributeDefinition[], attrs: KeyAttr[]): AttributeDefinition[] {
  const out = [...defs];
  for (const a of attrs) {
    const have = out.find((d) => d.AttributeName === a.name);
    if (have && have.AttributeType !== a.type) throw new Error(`The attribute ${a.name} is already a key of type ${TYPE_LABEL[have.AttributeType ?? ""] ?? have.AttributeType}. Use the same type.`);
    if (!have) out.push({ AttributeName: a.name, AttributeType: a.type as ScalarAttributeType });
  }
  return out;
}

/** An attribute name with its data type next to it. */
export function KeyField({ label, description, error, name, type, placeholder, disabled, onName, onType }: { label: string; description?: string; error?: string; name: string; type: string; placeholder?: string; disabled?: boolean; onName: (v: string) => void; onType: (v: string) => void }) {
  return (
    <FormField label={label} description={description} errorText={error} stretch>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px", gap: 8, maxWidth: 640 }}>
        <Input value={name} placeholder={placeholder} disabled={disabled} ariaLabel={label} onChange={(e) => onName(e.detail.value)} />
        <Select
          selectedOption={KEY_TYPES.find((t) => t.value === type) ?? KEY_TYPES[0]}
          options={KEY_TYPES}
          disabled={disabled}
          ariaLabel={`${label} type`}
          onChange={(e) => onType(e.detail.selectedOption.value ?? "S")}
        />
      </div>
    </FormField>
  );
}

/** The fields of one secondary index. Used on the create table page and in the create index dialog. */
export function IndexFields({ draft, tablePk, onChange }: { draft: IndexDraft; tablePk?: string; onChange: (d: IndexDraft) => void }) {
  const set = (patch: Partial<IndexDraft>) => onChange({ ...draft, ...patch });
  const local = draft.kind === "LOCAL";
  return (
    <SpaceBetween size="m">
      <FormField label="Index name" constraintText={NAME_HINT}>
        <Input value={draft.name} placeholder={local ? "my-local-index" : "my-index"} onChange={(e) => set({ name: e.detail.value })} />
      </FormField>
      {local ? (
        <FormField label="Partition key" description="A local secondary index has the same partition key as the table.">
          <Input value={tablePk ?? ""} disabled />
        </FormField>
      ) : (
        <KeyField label="Partition key" name={draft.pk} type={draft.pkType} placeholder="Enter the partition key name" onName={(pk) => set({ pk })} onType={(pkType) => set({ pkType })} />
      )}
      <KeyField label={local ? "Sort key" : "Sort key - optional"} name={draft.sk} type={draft.skType} placeholder="Enter the sort key name" onName={(sk) => set({ sk })} onType={(skType) => set({ skType })} />
      <FormField label="Attribute projections" description="The attributes of the table that are copied to the index.">
        <Select selectedOption={PROJECTIONS.find((p) => p.value === draft.projection) ?? PROJECTIONS[0]} options={PROJECTIONS} onChange={(e) => set({ projection: e.detail.selectedOption.value ?? "ALL" })} />
      </FormField>
      {draft.projection === "INCLUDE" && (
        <FormField label="Attributes to include" description="Names of the attributes, separated by commas. The keys are always included.">
          <Input value={draft.include} placeholder="price, title" onChange={(e) => set({ include: e.detail.value })} />
        </FormField>
      )}
    </SpaceBetween>
  );
}
