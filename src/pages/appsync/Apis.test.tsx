import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The AppSync client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/appsync", () => ({ appsync: { send } }));
vi.mock("../../clients/cognito", () => ({ cognito: { send: vi.fn() } }));
vi.mock("../../clients/lambda", () => ({ lambda: { send: vi.fn() } }));

import Apis from "./Apis";
import { parseTypes, schemaErrors } from "./appsyncutil";

const ENDPOINT = "http://floci:4566/v1/apis/abc123/graphql";
let apis: { apiId: string; name: string }[];

beforeEach(() => {
  apis = [{ apiId: "abc123", name: "orders" }];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListGraphqlApisCommand":
        return { graphqlApis: apis.map((a) => ({ ...a, authenticationType: "API_KEY", apiType: "GRAPHQL", uris: { GRAPHQL: ENDPOINT } })) };
      case "CreateGraphqlApiCommand":
        return { graphqlApi: { apiId: "new456", name: command.input.name } };
      case "CreateApiKeyCommand":
        return { apiKey: { id: "da2-test" } };
      case "DeleteGraphqlApiCommand":
        apis = apis.filter((a) => a.apiId !== command.input.apiId);
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

function open() {
  render(
    <MemoryRouter initialEntries={["/appsync/apis"]}>
      <NotifyProvider>
        <Apis />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("AppSync APIs page", () => {
  it("lists the APIs with their auth mode and endpoint", async () => {
    open();
    expect(await screen.findByRole("link", { name: "orders" })).toHaveAttribute("href", "/appsync/apis/abc123");
    const row = within(screen.getByRole("link", { name: "orders" }).closest("tr")!);
    expect(row.getByText("abc123")).toBeInTheDocument();
    expect(row.getByText("GraphQL")).toBeInTheDocument();
    expect(row.getByText("API key")).toBeInTheDocument();
    expect(row.getByText(ENDPOINT)).toBeInTheDocument();
  });

  it("creates an API key API and its first key", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create API"));
    await userEvent.type(await screen.findByPlaceholderText("my-api"), "invoices");
    await userEvent.click(dialogButton("Create API"));
    await waitFor(() => expect(sent("CreateApiKeyCommand")).toHaveLength(1));
    expect(sent("CreateGraphqlApiCommand")[0].input).toEqual({ name: "invoices", authenticationType: "API_KEY" });
    expect(sent("CreateApiKeyCommand")[0].input).toEqual({ apiId: "new456" });
  });

  it("rejects an API name with invalid characters", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create API"));
    await userEvent.type(await screen.findByPlaceholderText("my-api"), "bad/name!");
    await userEvent.click(dialogButton("Create API"));
    expect(await screen.findByText(/Enter a name of 1 to 65 characters/)).toBeInTheDocument();
    expect(sent("CreateGraphqlApiCommand")).toHaveLength(0);
  });

  it("deletes the selected API only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(sent("DeleteGraphqlApiCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteGraphqlApiCommand")).toHaveLength(1));
    expect(sent("DeleteGraphqlApiCommand")[0].input).toEqual({ apiId: "abc123" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "orders" })).not.toBeInTheDocument());
  });
});

describe("AppSync schema helpers", () => {
  it("reads the types and fields of a schema", () => {
    const sdl = `# a comment
type Query { hello(name: String, limit: Int): String
  items: [Item!]! }
"""An item."""
type Item @aws_api_key { id: ID!
  title: String }
extend type Query { more: Int }
schema { query: Query }`;
    expect(parseTypes(sdl)).toEqual([
      { type: "Query", field: "hello", returns: "String" },
      { type: "Query", field: "items", returns: "[Item!]!" },
      { type: "Item", field: "id", returns: "ID!" },
      { type: "Item", field: "title", returns: "String" },
      { type: "Query", field: "more", returns: "Int" },
    ]);
  });

  it("gives one line per schema error", () => {
    const details = JSON.stringify({ reason: "CODE_ERROR", detail: { codeErrors: [{ value: "The field type 'Nope' is not present" }] } });
    expect(schemaErrors(details)).toEqual(["The field type 'Nope' is not present"]);
    expect(schemaErrors("plain text")).toEqual(["plain text"]);
  });
});
