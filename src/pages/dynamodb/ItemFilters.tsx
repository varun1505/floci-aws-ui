import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { FILTER_OPS, type FilterOp, type FilterRow, VALUE_TYPES, type ValueType } from "./dynamoutil";

const PLACEHOLDER: Record<ValueType, string> = { S: "Enter attribute value", N: "Enter a number", B: "Enter base64 text", BOOL: "true or false", NULL: "" };

/** The filter rows of a scan or query: attribute name, type, condition and value. */
export function ItemFilters({ filters, onChange }: { filters: FilterRow[]; onChange: (filters: FilterRow[]) => void }) {
  const set = (index: number, patch: Partial<FilterRow>) => onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  return (
    <AttributeEditor
      items={filters}
      addButtonText="Add filter"
      removeButtonText="Remove"
      empty="No filters. Every item that is read is returned."
      onAddButtonClick={() => onChange([...filters, { name: "", type: "S", op: "=", value: "", value2: "" }])}
      onRemoveButtonClick={(e) => onChange(filters.filter((_, i) => i !== e.detail.itemIndex))}
      definition={[
        { label: "Attribute name", control: (f, i) => <Input value={f.name} placeholder="Enter attribute name" ariaLabel="Attribute name" onChange={(e) => set(i, { name: e.detail.value })} /> },
        {
          label: "Type",
          control: (f, i) => (
            <Select selectedOption={VALUE_TYPES.find((t) => t.value === f.type) ?? VALUE_TYPES[0]} options={VALUE_TYPES} ariaLabel="Type" onChange={(e) => set(i, { type: e.detail.selectedOption.value as ValueType })} />
          ),
        },
        {
          label: "Condition",
          control: (f, i) => (
            <Select selectedOption={FILTER_OPS.find((o) => o.value === f.op) ?? FILTER_OPS[0]} options={FILTER_OPS} ariaLabel="Condition" onChange={(e) => set(i, { op: e.detail.selectedOption.value as FilterOp })} />
          ),
        },
        {
          label: "Value",
          control: (f, i) => {
            const none = f.op === "exists" || f.op === "not_exists" || f.type === "NULL";
            return (
              <SpaceBetween size="xs">
                <Input value={none ? "" : f.value} disabled={none} placeholder={PLACEHOLDER[f.type]} ariaLabel="Value" onChange={(e) => set(i, { value: e.detail.value })} />
                {f.op === "between" && !none && <Input value={f.value2} placeholder="Enter the upper value" ariaLabel="Upper value" onChange={(e) => set(i, { value2: e.detail.value })} />}
              </SpaceBetween>
            );
          },
        },
      ]}
    />
  );
}
