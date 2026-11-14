import type { AttributeValue } from "@aws-sdk/client-dynamodb";

// Items and how they are written as text.
// DynamoDB JSON names every type: {"age": {"N": "42"}}.
// Plain JSON is the short form: {"age": 42}. Sets and binary values have no plain form,
// so they keep their type name: {"SS": ["a", "b"]}, {"NS": [1, 2]}, {"BS": ["aGk="]}, {"B": "aGk="}.

export type Item = Record<string, AttributeValue>;
export type ItemFormat = "plain" | "dynamodb";

/** A number kept as the text the user or DynamoDB wrote. A JavaScript number would round large values. */
export class Num {
  constructor(readonly text: string) {}
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MARK = "\u0000number";

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  if (!BASE64.test(text)) throw new Error(`"${text}" is not base64. Binary values are written in base64.`);
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function checkNumber(text: unknown, where: string): string {
  if (typeof text !== "string" || !JSON_NUMBER.test(text)) throw new Error(`${where}: ${JSON.stringify(text)} is not a number. Write a number such as 12 or -3.5.`);
  return text;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Num);
const filled = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;

// ---- DynamoDB JSON

/** One attribute value as DynamoDB JSON. Binary values become base64 text. */
export function toDynamo(av: AttributeValue): unknown {
  if (av.S !== undefined) return { S: av.S };
  if (av.N !== undefined) return { N: av.N };
  if (av.BOOL !== undefined) return { BOOL: av.BOOL };
  if (av.NULL !== undefined) return { NULL: true };
  if (av.B !== undefined) return { B: toBase64(av.B) };
  if (av.SS !== undefined) return { SS: av.SS };
  if (av.NS !== undefined) return { NS: av.NS };
  if (av.BS !== undefined) return { BS: av.BS.map(toBase64) };
  if (av.L !== undefined) return { L: av.L.map(toDynamo) };
  if (av.M !== undefined) return { M: Object.fromEntries(Object.entries(av.M).map(([k, v]) => [k, toDynamo(v)])) };
  throw new Error("This attribute has a type the console does not know.");
}

/** Reads one attribute value written as DynamoDB JSON. `where` names the attribute in error messages. */
export function fromDynamo(value: unknown, where: string): AttributeValue {
  const keys = isObject(value) ? Object.keys(value) : [];
  if (!isObject(value) || keys.length !== 1) throw new Error(`${where}: write the value with one type, such as {"S": "text"} or {"N": "12"}.`);
  const type = keys[0];
  const v = value[type];
  const strings = (what: string) => {
    if (!filled(v) || !v.every((x) => typeof x === "string")) throw new Error(`${where}: ${type} must be a list of ${what} with at least one entry.`);
    return v as string[];
  };
  switch (type) {
    case "S":
      if (typeof v !== "string") throw new Error(`${where}: S must be text in quotes.`);
      return { S: v };
    case "N":
      return { N: checkNumber(v, where) };
    case "BOOL":
      if (typeof v !== "boolean") throw new Error(`${where}: BOOL must be true or false.`);
      return { BOOL: v };
    case "NULL":
      if (v !== true) throw new Error(`${where}: NULL must be true.`);
      return { NULL: true };
    case "B":
      if (typeof v !== "string") throw new Error(`${where}: B must be base64 text.`);
      return { B: fromBase64(v) };
    case "SS":
      return { SS: strings("texts") };
    case "NS":
      return { NS: strings("numbers in quotes").map((n) => checkNumber(n, where)) };
    case "BS":
      return { BS: strings("base64 texts").map(fromBase64) };
    case "L":
      if (!Array.isArray(v)) throw new Error(`${where}: L must be a list.`);
      return { L: v.map((x, i) => fromDynamo(x, `${where}[${i}]`)) };
    case "M":
      if (!isObject(v)) throw new Error(`${where}: M must be an object.`);
      return { M: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromDynamo(x, `${where}.${k}`)])) };
    default:
      throw new Error(`${where}: "${type}" is not a DynamoDB type. Use S, N, B, BOOL, NULL, L, M, SS, NS or BS.`);
  }
}

// ---- Plain JSON

/** The type name when a plain object stands for a set or a binary value. */
function taggedType(v: Record<string, unknown>): "SS" | "NS" | "BS" | "B" | undefined {
  const keys = Object.keys(v);
  if (keys.length !== 1) return undefined;
  const x = v[keys[0]];
  const isBase64 = (s: unknown) => typeof s === "string" && BASE64.test(s);
  if (keys[0] === "B" && isBase64(x)) return "B";
  if (keys[0] === "SS" && filled(x) && x.every((s) => typeof s === "string")) return "SS";
  if (keys[0] === "NS" && filled(x) && x.every((n) => n instanceof Num || typeof n === "number")) return "NS";
  if (keys[0] === "BS" && filled(x) && x.every(isBase64)) return "BS";
  return undefined;
}

/** One attribute value as plain JSON. Numbers become `Num` so their text stays exact. */
export function toPlain(av: AttributeValue): unknown {
  if (av.S !== undefined) return av.S;
  if (av.N !== undefined) return new Num(av.N);
  if (av.BOOL !== undefined) return av.BOOL;
  if (av.NULL !== undefined) return null;
  if (av.B !== undefined) return { B: toBase64(av.B) };
  if (av.SS !== undefined) return { SS: av.SS };
  if (av.NS !== undefined) return { NS: av.NS.map((n) => new Num(n)) };
  if (av.BS !== undefined) return { BS: av.BS.map(toBase64) };
  if (av.L !== undefined) return av.L.map(toPlain);
  if (av.M !== undefined) {
    const map = Object.fromEntries(Object.entries(av.M).map(([k, v]) => [k, toPlain(v)]));
    // A map such as {"SS": ["a"]} would be read back as a set. Refuse it, so no data changes type.
    if (taggedType(map)) throw new Error(`A map with the single key "${Object.keys(map)[0]}" looks like a set or binary value in plain JSON. Use DynamoDB JSON for this item.`);
    return map;
  }
  throw new Error("This attribute has a type the console does not know.");
}

/** Reads one attribute value written as plain JSON. */
export function fromPlain(value: unknown, where: string): AttributeValue {
  if (typeof value === "string") return { S: value };
  if (value instanceof Num) return { N: checkNumber(value.text, where) };
  if (typeof value === "number") return { N: checkNumber(String(value), where) };
  if (typeof value === "boolean") return { BOOL: value };
  if (value === null) return { NULL: true };
  if (Array.isArray(value)) return { L: value.map((x, i) => fromPlain(x, `${where}[${i}]`)) };
  if (isObject(value)) {
    const type = taggedType(value);
    if (type === "B") return { B: fromBase64(value.B as string) };
    if (type === "SS") return { SS: value.SS as string[] };
    if (type === "NS") return { NS: (value.NS as (Num | number)[]).map((n) => checkNumber(n instanceof Num ? n.text : String(n), where)) };
    if (type === "BS") return { BS: (value.BS as string[]).map(fromBase64) };
    return { M: Object.fromEntries(Object.entries(value).map(([k, x]) => [k, fromPlain(x, `${where}.${k}`)])) };
  }
  throw new Error(`${where}: this value can't be stored.`);
}

// ---- Text

/** DynamoDB accepts number texts that JSON does not, such as ".5" or "007". This writes them the JSON way. */
function jsonNumber(text: string): string {
  if (JSON_NUMBER.test(text)) return text;
  return text
    .replace(/^\+/, "")
    .replace(/^(-?)0+(?=\d)/, "$1")
    .replace(/^(-?)\./, "$10.")
    .replace(/\.(?=$|[eE])/, "");
}

/** JSON.stringify with two-space indent, but a `Num` is written as its exact text. */
export function writeJson(v: unknown, pad = ""): string {
  if (v instanceof Num) return jsonNumber(v.text);
  const inner = `${pad}  `;
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => inner + writeJson(x, inner)).join(",\n")}\n${pad}]` : "[]";
  if (isObject(v)) {
    const entries = Object.entries(v);
    return entries.length ? `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${writeJson(x, inner)}`).join(",\n")}\n${pad}}` : "{}";
  }
  return JSON.stringify(v);
}

/** JSON.parse, but every number comes back as a `Num` with its exact text. */
export function readJson(text: string): unknown {
  // Wrap each number that is outside a string in a marker object. JSON.parse then never turns it into a float.
  const marked = text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m) => (m[0] === '"' ? m : `{"\\u0000number":"${m}"}`));
  try {
    return JSON.parse(marked, (_key, v) => (isObject(v) && Object.keys(v).length === 1 && typeof v[MARK] === "string" ? new Num(v[MARK]) : v));
  } catch (e) {
    // Parse the text as typed, so the error message points at the user's own text.
    JSON.parse(text);
    throw e;
  }
}

export function formatItem(item: Item, format: ItemFormat): string {
  const convert = format === "plain" ? toPlain : toDynamo;
  return writeJson(Object.fromEntries(Object.entries(item).map(([k, v]) => [k, convert(v)])));
}

export function parseItem(text: string, format: ItemFormat): Item {
  let doc: unknown;
  try {
    doc = format === "plain" ? readJson(text) : JSON.parse(text);
  } catch (e) {
    throw new Error(`The item is not valid JSON. ${e instanceof Error ? e.message : ""}`.trim());
  }
  if (!isObject(doc)) throw new Error("The item must be a JSON object: { ... }.");
  return Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, format === "plain" ? fromPlain(v, k) : fromDynamo(v, k)]));
}

/** Short text for a table cell. */
export function cellText(av: AttributeValue | undefined): string {
  if (!av) return "";
  if (av.S !== undefined) return av.S;
  if (av.N !== undefined) return av.N;
  if (av.BOOL !== undefined) return String(av.BOOL);
  if (av.NULL !== undefined) return "null";
  if (av.B !== undefined) return toBase64(av.B);
  let value: unknown;
  try {
    value = toPlain(av);
  } catch {
    value = toDynamo(av);
  }
  return writeJson(value).replace(/\s*\n\s*/g, " ");
}

/** The name of a value's type: S, N, BOOL and so on. */
export function typeOf(av: AttributeValue): string {
  return Object.entries(av).find(([, v]) => v !== undefined)?.[0] ?? "";
}

// ---- Scan and Query requests

export type ValueType = "S" | "N" | "B" | "BOOL" | "NULL";
export type KeyAttr = { name: string; type: string };
export type SortOp = "=" | "<" | "<=" | ">" | ">=" | "between" | "begins_with";
export type FilterOp = "=" | "<>" | "<" | "<=" | ">" | ">=" | "between" | "exists" | "not_exists" | "contains" | "not_contains" | "begins_with";
export type FilterRow = { name: string; type: ValueType; op: FilterOp; value: string; value2: string };

export const SORT_OPS: { value: SortOp; label: string }[] = [
  { value: "=", label: "Equal to" },
  { value: "<", label: "Less than" },
  { value: "<=", label: "Less than or equal to" },
  { value: ">", label: "Greater than" },
  { value: ">=", label: "Greater than or equal to" },
  { value: "between", label: "Between" },
  { value: "begins_with", label: "Begins with" },
];

export const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "=", label: "Equal to" },
  { value: "<>", label: "Not equal to" },
  { value: "<=", label: "Less than or equal to" },
  { value: "<", label: "Less than" },
  { value: ">=", label: "Greater than or equal to" },
  { value: ">", label: "Greater than" },
  { value: "between", label: "Between" },
  { value: "exists", label: "Exists" },
  { value: "not_exists", label: "Not exists" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Not contains" },
  { value: "begins_with", label: "Begins with" },
];

export const VALUE_TYPES: { value: ValueType; label: string }[] = [
  { value: "S", label: "String" },
  { value: "N", label: "Number" },
  { value: "B", label: "Binary" },
  { value: "BOOL", label: "Boolean" },
  { value: "NULL", label: "Null" },
];

/** Turns the text of a form field into an attribute value of the chosen type. */
export function typedValue(type: string, text: string, where: string): AttributeValue {
  switch (type) {
    case "N":
      return { N: checkNumber(text.trim(), where) };
    case "B":
      return { B: fromBase64(text.trim()) };
    case "BOOL":
      if (text.trim() !== "true" && text.trim() !== "false") throw new Error(`${where}: enter true or false.`);
      return { BOOL: text.trim() === "true" };
    case "NULL":
      return { NULL: true };
    default:
      return { S: text };
  }
}

export type ReadSpec = {
  table: string;
  index?: string;
  mode: "scan" | "query";
  pk?: KeyAttr;
  pkValue?: string;
  sk?: KeyAttr;
  skOp?: SortOp;
  skValue?: string;
  skValue2?: string;
  filters: FilterRow[];
  limit: number;
};

export type ReadInput = {
  TableName: string;
  IndexName?: string;
  Limit: number;
  KeyConditionExpression?: string;
  FilterExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Item;
};

/** Builds the Scan or Query request of the form. Throws an error with a message for the user when a field is wrong. */
export function buildRead(spec: ReadSpec): ReadInput {
  const names: Record<string, string> = {};
  const values: Item = {};
  const name = (attr: string) => {
    const existing = Object.keys(names).find((k) => names[k] === attr);
    if (existing) return existing;
    const key = `#n${Object.keys(names).length}`;
    names[key] = attr;
    return key;
  };
  const value = (av: AttributeValue) => {
    const key = `:v${Object.keys(values).length}`;
    values[key] = av;
    return key;
  };
  const condition = (attr: string, op: string, type: string, a: string, b: string, where: string) => {
    const n = name(attr);
    if (op === "exists") return `attribute_exists(${n})`;
    if (op === "not_exists") return `attribute_not_exists(${n})`;
    const first = value(typedValue(type, a, where));
    if (op === "between") return `${n} BETWEEN ${first} AND ${value(typedValue(type, b, where))}`;
    if (op === "begins_with") return `begins_with(${n}, ${first})`;
    if (op === "contains") return `contains(${n}, ${first})`;
    if (op === "not_contains") return `NOT contains(${n}, ${first})`;
    return `${n} ${op} ${first}`;
  };

  const input: ReadInput = { TableName: spec.table, IndexName: spec.index || undefined, Limit: spec.limit };

  if (spec.mode === "query") {
    if (!spec.pk) throw new Error("Choose a table first.");
    if (!spec.pkValue) throw new Error(`Enter a value for the partition key ${spec.pk.name}.`);
    const parts = [condition(spec.pk.name, "=", spec.pk.type, spec.pkValue, "", `Partition key ${spec.pk.name}`)];
    if (spec.sk && spec.skValue) {
      const op = spec.skOp ?? "=";
      if (op === "between" && !spec.skValue2) throw new Error(`Enter both values for the sort key ${spec.sk.name}.`);
      if (op === "begins_with" && spec.sk.type === "N") throw new Error("Begins with does not work on a number sort key.");
      parts.push(condition(spec.sk.name, op, spec.sk.type, spec.skValue, spec.skValue2 ?? "", `Sort key ${spec.sk.name}`));
    }
    input.KeyConditionExpression = parts.join(" AND ");
  }

  const filters = spec.filters.filter((f) => f.name.trim());
  if (filters.length) {
    input.FilterExpression = filters
      .map((f) => {
        const attr = f.name.trim();
        const needsValue = f.op !== "exists" && f.op !== "not_exists" && f.type !== "NULL";
        if (needsValue && !f.value) throw new Error(`Enter a value for the filter on ${attr}.`);
        if (f.op === "between" && !f.value2 && f.type !== "NULL") throw new Error(`Enter both values for the filter on ${attr}.`);
        return condition(attr, f.op, f.type, f.value, f.value2, `Filter on ${attr}`);
      })
      .join(" AND ");
  }

  if (Object.keys(names).length) input.ExpressionAttributeNames = names;
  if (Object.keys(values).length) input.ExpressionAttributeValues = values;
  return input;
}

/** The key of an item, as the attributes of `keys` only. */
export function keyOf(item: Item, keys: (KeyAttr | undefined)[]): Item {
  const out: Item = {};
  for (const k of keys) if (k && item[k.name]) out[k.name] = item[k.name];
  return out;
}

/** A text that is the same for two items with the same key. */
export const keyText = (item: Item, keys: (KeyAttr | undefined)[]) => JSON.stringify(Object.values(keyOf(item, keys)).map(toDynamo));
