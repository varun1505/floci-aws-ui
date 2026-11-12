import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Input from "@cloudscape-design/components/input";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";

export type SecretDraft = { mode: "pairs" | "plain"; pairs: { key: string; value: string }[]; plain: string };

/** Split a stored secret into key/value pairs when it is a flat JSON object. Otherwise keep it as text. */
export function draftFrom(secretString: string): SecretDraft {
  try {
    const parsed = JSON.parse(secretString);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((v) => typeof v === "string")) {
      return { mode: "pairs", pairs: Object.entries(parsed as Record<string, string>).map(([key, value]) => ({ key, value })), plain: secretString };
    }
  } catch {
    /* not JSON */
  }
  return { mode: "plain", pairs: [{ key: "", value: "" }], plain: secretString };
}

export function draftToString(draft: SecretDraft): string {
  if (draft.mode === "plain") return draft.plain;
  return JSON.stringify(Object.fromEntries(draft.pairs.filter((p) => p.key).map((p) => [p.key, p.value])));
}

export function draftError(draft: SecretDraft): string {
  if (draft.mode === "plain") return draft.plain ? "" : "Enter a secret value.";
  const keys = draft.pairs.map((p) => p.key).filter(Boolean);
  if (keys.length === 0) return "Add at least one key/value pair.";
  if (new Set(keys).size !== keys.length) return "Each key must be unique.";
  return "";
}

export function SecretValueEditor({ draft, onChange }: { draft: SecretDraft; onChange: (d: SecretDraft) => void }) {
  const setPair = (i: number, patch: Partial<{ key: string; value: string }>) =>
    onChange({ ...draft, pairs: draft.pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <SpaceBetween size="m">
      <SegmentedControl
        selectedId={draft.mode}
        onChange={(e) => {
          const mode = e.detail.selectedId as SecretDraft["mode"];
          // Carry the value across when switching views, if it converts cleanly.
          if (mode === "plain") onChange({ ...draft, mode, plain: draft.pairs.some((p) => p.key) ? JSON.stringify(Object.fromEntries(draft.pairs.filter((p) => p.key).map((p) => [p.key, p.value])), null, 2) : draft.plain });
          else onChange({ ...draftFrom(draft.plain), mode: "pairs", plain: draft.plain });
        }}
        options={[
          { id: "pairs", text: "Key/value" },
          { id: "plain", text: "Plaintext" },
        ]}
      />
      {draft.mode === "pairs" ? (
        <AttributeEditor
          items={draft.pairs}
          addButtonText="Add row"
          removeButtonText="Remove"
          empty="No key/value pairs."
          onAddButtonClick={() => onChange({ ...draft, pairs: [...draft.pairs, { key: "", value: "" }] })}
          onRemoveButtonClick={(e) => onChange({ ...draft, pairs: draft.pairs.filter((_, i) => i !== e.detail.itemIndex) })}
          definition={[
            { label: "Key", control: (item, i) => <Input value={item.key} placeholder="username" onChange={(e) => setPair(i, { key: e.detail.value })} /> },
            { label: "Value", control: (item, i) => <Input value={item.value} onChange={(e) => setPair(i, { value: e.detail.value })} /> },
          ]}
        />
      ) : (
        <Textarea value={draft.plain} rows={8} onChange={(e) => onChange({ ...draft, plain: e.detail.value })} spellcheck={false} />
      )}
    </SpaceBetween>
  );
}
