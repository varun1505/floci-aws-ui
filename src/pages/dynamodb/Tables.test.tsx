import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The DynamoDB client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/dynamodb", () => ({ dynamodb: { send } }));
// The real code editor needs a full browser. A plain text box is enough here.
vi.mock("../../components/Code", () => ({
  Code: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <textarea aria-label="Item JSON" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import CreateTable from "./CreateTable";
import ExploreItems from "./ExploreItems";
import Tables from "./Tables";
import { type Item, Num, buildRead, cellText, formatItem, fromBase64, parseItem, readJson, toBase64, writeJson } from "./dynamoutil";

const ORDERS = {
  TableName: "orders",
  TableStatus: "ACTIVE",
  KeySchema: [
    { AttributeName: "customer", KeyType: "HASH" },
    { AttributeName: "placed", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "customer", AttributeType: "S" },
    { AttributeName: "placed", AttributeType: "N" },
    { AttributeName: "status", AttributeType: "S" },
  ],
  BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" },
  GlobalSecondaryIndexes: [{ IndexName: "by-status", KeySchema: [{ AttributeName: "status", KeyType: "HASH" }] }],
  ItemCount: 42,
  TableSizeBytes: 2048,
};
const ROWS: Item[] = [
  { customer: { S: "ann" }, placed: { N: "1" }, total: { N: "12345678901234567890.5" } },
  { customer: { S: "ann" }, placed: { N: "2" }, tags: { SS: ["a", "b"] } },
  { customer: { S: "bob" }, placed: { N: "3" }, paid: { BOOL: true } },
];
let tables: string[];

beforeEach(() => {
  tables = ["orders"];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, any> }) => {
    switch (command.constructor.name) {
      case "ListTablesCommand":
        return { TableNames: tables };
      case "DescribeTableCommand":
        return { Table: ORDERS };
      case "CreateTableCommand":
        return { TableDescription: { TableName: command.input.TableName } };
      case "DeleteTableCommand":
        tables = tables.filter((t) => t !== command.input.TableName);
        return {};
      case "ScanCommand": {
        // Two items per page, so the page has to ask for the next one.
        const from = command.input.ExclusiveStartKey ? 2 : 0;
        const page = ROWS.slice(from, from + 2);
        return { Items: page, Count: page.length, ScannedCount: page.length, LastEvaluatedKey: from === 0 ? { customer: { S: "ann" }, placed: { N: "2" } } : undefined };
      }
      case "QueryCommand":
        return { Items: [ROWS[2]], Count: 1, ScannedCount: 1 };
      case "GetItemCommand":
        return { Item: ROWS.find((r) => r.placed.N === command.input.Key.placed.N) };
      case "PutItemCommand":
      case "DeleteItemCommand":
        return {};
      default:
        throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  });
});

const sent = (name: string) => send.mock.calls.map(([c]) => c).filter((c) => c.constructor.name === name);

// The dialogs are in the page even when closed, so a button name can match twice.
// The page's own button comes first. The dialog's button comes last.
const pageButton = (name: string) => screen.getAllByRole("button", { name })[0];
const dialogButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;

function open(page: React.ReactNode, path = "/dynamodb/tables") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <NotifyProvider>{page}</NotifyProvider>
    </MemoryRouter>,
  );
}

describe("DynamoDB tables page", () => {
  it("lists the tables with their keys, indexes and counts", async () => {
    open(<Tables />);
    expect(await screen.findByRole("link", { name: "orders" })).toHaveAttribute("href", "/dynamodb/table?name=orders");
    const row = within(screen.getByRole("link", { name: "orders" }).closest("tr")!);
    expect(row.getByText("Active")).toBeInTheDocument();
    expect(row.getByText("customer (String)")).toBeInTheDocument();
    expect(row.getByText("placed (Number)")).toBeInTheDocument();
    expect(row.getByText("On-demand")).toBeInTheDocument();
    expect(row.getByText("42")).toBeInTheDocument();
    expect(row.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("deletes the selected table only after the user confirms", async () => {
    open(<Tables />);
    await screen.findByRole("link", { name: "orders" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(sent("DeleteTableCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("confirm"), "confirm");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteTableCommand")).toHaveLength(1));
    expect(sent("DeleteTableCommand")[0].input).toEqual({ TableName: "orders" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "orders" })).not.toBeInTheDocument());
  });
});

describe("DynamoDB create table page", () => {
  it("creates a table with the values of the form", async () => {
    open(<CreateTable />, "/dynamodb/tables/create");
    await userEvent.type(screen.getByPlaceholderText("Enter name for table"), "invoices");
    await userEvent.type(screen.getByPlaceholderText("Enter the partition key name"), "id");
    await userEvent.type(screen.getByPlaceholderText("Enter the sort key name"), "day");
    await userEvent.click(screen.getByRole("button", { name: "Create global index" }));
    await userEvent.type(screen.getByPlaceholderText("my-index"), "by-owner");
    await userEvent.type(screen.getAllByPlaceholderText("Enter the partition key name")[1], "owner");
    await userEvent.click(screen.getByRole("button", { name: "Create table" }));
    await waitFor(() => expect(sent("CreateTableCommand")).toHaveLength(1));
    expect(sent("CreateTableCommand")[0].input).toEqual({
      TableName: "invoices",
      KeySchema: [
        { AttributeName: "id", KeyType: "HASH" },
        { AttributeName: "day", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "day", AttributeType: "S" },
        { AttributeName: "owner", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
      ProvisionedThroughput: undefined,
      GlobalSecondaryIndexes: [{ IndexName: "by-owner", KeySchema: [{ AttributeName: "owner", KeyType: "HASH" }], Projection: { ProjectionType: "ALL" }, ProvisionedThroughput: undefined }],
    });
  });

  it("rejects a table name that is too short", async () => {
    open(<CreateTable />, "/dynamodb/tables/create");
    await userEvent.type(screen.getByPlaceholderText("Enter name for table"), "ab");
    await userEvent.click(screen.getByRole("button", { name: "Create table" }));
    expect(await screen.findByText("Enter a partition key name.")).toBeInTheDocument();
    expect(sent("CreateTableCommand")).toHaveLength(0);
  });
});

describe("DynamoDB explore items page", () => {
  it("scans the table, shows the key columns first and reads the next page", async () => {
    open(<ExploreItems />, "/dynamodb/items?table=orders");
    expect(await screen.findByText("12345678901234567890.5")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers.slice(1, 4)).toEqual(["customer (Partition key)", "placed (Sort key)", "total"]);
    expect(screen.getByText('{ "SS": [ "a", "b" ] }')).toBeInTheDocument();
    expect(screen.getByText(/Items returned: 2\. Items scanned: 2\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retrieve next page" }));
    expect(await screen.findByRole("button", { name: "bob" })).toBeInTheDocument();
    expect(sent("ScanCommand")[1].input.ExclusiveStartKey).toEqual({ customer: { S: "ann" }, placed: { N: "2" } });
    expect(screen.getByText(/Items returned: 3\. Items scanned: 3\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retrieve next page" })).not.toBeInTheDocument();
  });

  it("saves an edited item without rounding a large number", async () => {
    open(<ExploreItems />, "/dynamodb/items?table=orders");
    await userEvent.click((await screen.findAllByRole("button", { name: "ann" }))[0]);
    const box = await screen.findByLabelText("Item JSON");
    expect((box as HTMLTextAreaElement).value).toContain('"total": 12345678901234567890.5');
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent("PutItemCommand")).toHaveLength(1));
    expect(sent("PutItemCommand")[0].input).toEqual({ TableName: "orders", Item: ROWS[0] });
  });
});

describe("DynamoDB item conversion", () => {
  const item: Item = {
    id: { S: "a" },
    big: { N: "12345678901234567890.123456789" },
    small: { N: "1e-130" },
    ok: { BOOL: false },
    none: { NULL: true },
    list: { L: [{ S: "x" }, { N: "2" }, { L: [] }] },
    map: { M: { inner: { M: {} }, n: { N: "-0.5" } } },
    tags: { SS: ["x", "y"] },
    nums: { NS: ["1", "99999999999999999999"] },
    bin: { B: new Uint8Array([104, 105]) },
    bins: { BS: [new Uint8Array([1, 2, 3])] },
  };

  it("writes and reads DynamoDB JSON without changing a value", () => {
    const text = formatItem(item, "dynamodb");
    expect(JSON.parse(text).big).toEqual({ N: "12345678901234567890.123456789" });
    expect(JSON.parse(text).bin).toEqual({ B: "aGk=" });
    expect(parseItem(text, "dynamodb")).toEqual(item);
  });

  it("writes and reads plain JSON without rounding numbers", () => {
    const text = formatItem(item, "plain");
    expect(text).toContain('"big": 12345678901234567890.123456789');
    expect(text).toContain("99999999999999999999");
    expect(text).toContain('"none": null');
    expect(parseItem(text, "plain")).toEqual(item);
  });

  it("reads plain JSON that a user typed", () => {
    expect(parseItem('{"name": "Ann", "age": 42, "tags": ["a", 1.50], "address": {"zip": "12"}, "set": {"NS": [1, 2]}, "note": "costs 12 or -3"}', "plain")).toEqual({
      name: { S: "Ann" },
      age: { N: "42" },
      tags: { L: [{ S: "a" }, { N: "1.50" }] },
      address: { M: { zip: { S: "12" } } },
      set: { NS: ["1", "2"] },
      note: { S: "costs 12 or -3" },
    });
  });

  it("keeps the exact text of numbers when it reads and writes JSON", () => {
    const doc = readJson('{"a": 0.1000, "b": [9007199254740993], "c": "7"}') as { a: Num; b: Num[]; c: string };
    expect(doc.a).toEqual(new Num("0.1000"));
    expect(doc.b[0].text).toBe("9007199254740993");
    expect(doc.c).toBe("7");
    expect(writeJson({ n: new Num(".5"), m: new Num("007") })).toBe('{\n  "n": 0.5,\n  "m": 7\n}');
  });

  it("explains what is wrong with an item", () => {
    expect(() => parseItem("{", "plain")).toThrow(/not valid JSON/);
    expect(() => parseItem("[1]", "plain")).toThrow(/must be a JSON object/);
    expect(() => parseItem('{"a": {"N": 5}}', "dynamodb")).toThrow(/a: 5 is not a number/);
    expect(() => parseItem('{"a": {"X": "1"}}', "dynamodb")).toThrow(/"X" is not a DynamoDB type/);
    expect(() => parseItem('{"a": {"L": [{"S": 1}]}}', "dynamodb")).toThrow(/a\[0\]: S must be text/);
    expect(() => parseItem('{"a": {"SS": []}}', "dynamodb")).toThrow(/at least one entry/);
    expect(() => parseItem('{"a": {"B": "not base64!"}}', "dynamodb")).toThrow(/not base64/);
  });

  it("refuses plain JSON for a map that would be read back as a set", () => {
    expect(() => formatItem({ odd: { M: { SS: { L: [{ S: "a" }] } } } }, "plain")).toThrow(/Use DynamoDB JSON/);
    expect(formatItem({ fine: { M: { SS: { S: "a" } } } }, "plain")).toContain('"SS": "a"');
  });

  it("converts binary values to base64 and back", () => {
    expect(toBase64(fromBase64("aGVsbG8="))).toBe("aGVsbG8=");
    expect(cellText({ B: new Uint8Array([104, 105]) })).toBe("aGk=");
    expect(cellText({ M: { a: { N: "1" } } })).toBe('{ "a": 1 }');
  });
});

describe("DynamoDB scan and query requests", () => {
  const pk = { name: "customer", type: "S" };
  const sk = { name: "placed", type: "N" };

  it("builds a query with a sort key range and a filter", () => {
    expect(
      buildRead({ table: "orders", index: "by-day", mode: "query", pk, pkValue: "ann", sk, skOp: "between", skValue: "1", skValue2: "5", filters: [{ name: "total", type: "N", op: ">=", value: "10", value2: "" }], limit: 50 }),
    ).toEqual({
      TableName: "orders",
      IndexName: "by-day",
      Limit: 50,
      KeyConditionExpression: "#n0 = :v0 AND #n1 BETWEEN :v1 AND :v2",
      FilterExpression: "#n2 >= :v3",
      ExpressionAttributeNames: { "#n0": "customer", "#n1": "placed", "#n2": "total" },
      ExpressionAttributeValues: { ":v0": { S: "ann" }, ":v1": { N: "1" }, ":v2": { N: "5" }, ":v3": { N: "10" } },
    });
  });

  it("builds a scan with every kind of filter", () => {
    const row = (op: any, type: any = "S", value = "x") => ({ name: "a", type, op, value, value2: "z" });
    const input = buildRead({ table: "t", mode: "scan", filters: [row("exists"), row("not_exists"), row("contains"), row("not_contains"), row("begins_with"), row("<>"), row("between"), row("=", "BOOL", "true"), row("=", "NULL")], limit: 100 });
    expect(input.FilterExpression).toBe(
      "attribute_exists(#n0) AND attribute_not_exists(#n0) AND contains(#n0, :v0) AND NOT contains(#n0, :v1) AND begins_with(#n0, :v2) AND #n0 <> :v3 AND #n0 BETWEEN :v4 AND :v5 AND #n0 = :v6 AND #n0 = :v7",
    );
    expect(input.ExpressionAttributeValues?.[":v6"]).toEqual({ BOOL: true });
    expect(input.ExpressionAttributeValues?.[":v7"]).toEqual({ NULL: true });
    expect(input.KeyConditionExpression).toBeUndefined();
  });

  it("says which field is wrong", () => {
    expect(() => buildRead({ table: "t", mode: "query", pk, pkValue: "", filters: [], limit: 1 })).toThrow("Enter a value for the partition key customer.");
    expect(() => buildRead({ table: "t", mode: "query", pk, pkValue: "a", sk, skOp: "=", skValue: "abc", filters: [], limit: 1 })).toThrow(/Sort key placed: "abc" is not a number/);
    expect(() => buildRead({ table: "t", mode: "scan", filters: [{ name: "a", type: "S", op: "=", value: "", value2: "" }], limit: 1 })).toThrow("Enter a value for the filter on a.");
  });
});
