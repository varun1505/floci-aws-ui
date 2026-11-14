import { useState } from "react";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import Toggle from "@cloudscape-design/components/toggle";
import { dynamodb } from "../../clients/dynamodb";
import { Code } from "../../components/Code";
import { FormModal } from "../../components/FormModal";
import { useSubmit } from "../../lib/useSubmit";
import { type Item, type ItemFormat, type KeyAttr, formatItem, keyText, parseItem, typeOf } from "./dynamoutil";
import { keyLabel } from "./tableutil";

export type EditKind = "create" | "edit" | "duplicate";

const HEADER: Record<EditKind, string> = { create: "Create item", edit: "Edit item", duplicate: "Duplicate item" };

/** An empty item that has only the key attributes, as the start of a new item. */
function blankItem(keys: KeyAttr[]): Item {
  return Object.fromEntries(keys.map((k) => [k.name, k.type === "N" ? { N: "0" } : k.type === "B" ? { B: new Uint8Array() } : { S: "" }]));
}

/** Plain JSON when the item can be written that way, DynamoDB JSON when it can't. */
function startText(item: Item): { format: ItemFormat; text: string } {
  try {
    return { format: "plain", text: formatItem(item, "plain") };
  } catch {
    return { format: "dynamodb", text: formatItem(item, "dynamodb") };
  }
}

/** The dialog that creates, edits or duplicates one item as JSON. Mount it to open it. */
export function ItemEditor({ table, keys, kind, item, onClose, onSaved }: { table: string; keys: KeyAttr[]; kind: EditKind; item?: Item; onClose: () => void; onSaved: (message: string) => void }) {
  const form = useSubmit();
  const [start] = useState(() => startText(item ?? blankItem(keys)));
  const [format, setFormat] = useState<ItemFormat>(start.format);
  const [text, setText] = useState(start.text);

  const switchFormat = (next: ItemFormat) => {
    try {
      setText(formatItem(parseItem(text, format), next));
      setFormat(next);
      form.setError("");
    } catch (e) {
      form.setError(`Fix the item before you switch the view. ${e instanceof Error ? e.message : ""}`);
    }
  };

  const save = async () => {
    let next: Item;
    try {
      next = parseItem(text, format);
    } catch (e) {
      return form.setError(e instanceof Error ? e.message : String(e));
    }
    for (const k of keys) {
      if (!next[k.name] || typeOf(next[k.name]) !== k.type) return form.setError(`The item must have the key attribute ${keyLabel(k)}.`);
    }
    if (kind === "edit" && item && keyText(next, keys) !== keyText(item, keys)) return form.setError("You can't change the key of an item. Use Duplicate item to make a copy with another key.");
    const ok = await form.run(async () => {
      if (kind === "edit") {
        await dynamodb.send(new PutItemCommand({ TableName: table, Item: next }));
      } else {
        try {
          // A new item must not replace an item that is already there.
          await dynamodb.send(new PutItemCommand({ TableName: table, Item: next, ConditionExpression: "attribute_not_exists(#k)", ExpressionAttributeNames: { "#k": keys[0].name } }));
        } catch (e) {
          if ((e as { name?: string }).name === "ConditionalCheckFailedException") throw new Error(kind === "duplicate" ? "An item with this key already exists. Change the key of the copy." : "An item with this key already exists.");
          throw e;
        }
      }
    });
    if (ok) onSaved(kind === "edit" ? "The item was saved." : "The item was created.");
  };

  return (
    <FormModal visible size="large" header={HEADER[kind]} submitLabel={kind === "edit" ? "Save changes" : "Create item"} busy={form.busy} error={form.error} onDismiss={onClose} onSubmit={save}>
      <Toggle checked={format === "dynamodb"} onChange={(e) => switchFormat(e.detail.checked ? "dynamodb" : "plain")}>
        View DynamoDB JSON
      </Toggle>
      <Code value={text} onChange={setText} language="json" height={380} ariaLabel="Item JSON" />
    </FormModal>
  );
}
