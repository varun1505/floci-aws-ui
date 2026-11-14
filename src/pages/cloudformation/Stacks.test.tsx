import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The CloudFormation client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/cloudformation", () => ({ cloudformation: { send } }));
// The real code editor needs a full browser. A plain text box is enough here.
vi.mock("../../components/Code", () => ({
  Code: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <textarea aria-label="Template" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import CreateStack from "./CreateStack";
import Stacks from "./Stacks";
import { resourceHref, stackNameError } from "./cfnutil";
import { SAMPLES } from "./samples";

const ID = (name: string) => `arn:aws:cloudformation:us-east-1:000000000000:stack/${name}/1111`;
let stacks: { StackName: string; StackId: string; StackStatus: string; CreationTime: Date; TemplateDescription?: string }[];

beforeEach(() => {
  stacks = [
    { StackName: "shop", StackId: ID("shop"), StackStatus: "CREATE_COMPLETE", CreationTime: new Date("2026-01-02T10:00:00Z"), TemplateDescription: "The shop backend" },
    { StackName: "broken", StackId: ID("broken"), StackStatus: "ROLLBACK_COMPLETE", CreationTime: new Date("2026-01-01T10:00:00Z") },
    { StackName: "old", StackId: ID("old"), StackStatus: "DELETE_COMPLETE", CreationTime: new Date("2025-12-01T10:00:00Z") },
  ];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListStacksCommand":
        return { StackSummaries: stacks };
      case "DeleteStackCommand":
        stacks = stacks.map((s) => (s.StackName === command.input.StackName ? { ...s, StackStatus: "DELETE_COMPLETE" } : s));
        return {};
      case "GetTemplateSummaryCommand":
        if (String(command.input.TemplateBody).includes("TableName"))
          return {
            Parameters: [
              { ParameterKey: "TableName", DefaultValue: "orders", ParameterType: "String" },
              { ParameterKey: "KeyName", DefaultValue: "id", ParameterType: "String" },
            ],
            Capabilities: [],
          };
        return { Parameters: [], Capabilities: [] };
      case "DescribeStacksCommand":
        return { Stacks: [{ StackName: "shop", StackId: ID("shop"), StackStatus: "CREATE_COMPLETE", Parameters: [{ ParameterKey: "TableName", ParameterValue: "live-orders" }, { ParameterKey: "KeyName", ParameterValue: "id" }], Capabilities: [], Tags: [{ Key: "env", Value: "dev" }] }] };
      case "GetTemplateCommand":
        return { TemplateBody: SAMPLES[2].yaml };
      case "CreateStackCommand":
      case "UpdateStackCommand":
        return { StackId: ID(String(command.input.StackName)) };
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

function open(path = "/cloudformation/stacks") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <NotifyProvider>{path.includes("/create") ? <CreateStack /> : <Stacks />}</NotifyProvider>
    </MemoryRouter>,
  );
}

describe("CloudFormation stacks page", () => {
  it("lists the active stacks with status and description, and hides deleted ones", async () => {
    open();
    expect(await screen.findByRole("link", { name: "shop" })).toHaveAttribute("href", "/cloudformation/stack?name=shop");
    const row = within(screen.getByRole("link", { name: "shop" }).closest("tr")!);
    expect(row.getByText("CREATE_COMPLETE")).toBeInTheDocument();
    expect(row.getByText("The shop backend")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "broken" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "old" })).not.toBeInTheDocument();
  });

  it("deletes the selected stack only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "shop" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(within(screen.getByRole("link", { name: "shop" }).closest("tr")!).getByRole("radio"));
    await userEvent.click(del);
    expect(sent("DeleteStackCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteStackCommand")).toHaveLength(1));
    expect(sent("DeleteStackCommand")[0].input).toEqual({ StackName: "shop" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "shop" })).not.toBeInTheDocument());
  });
});

describe("Create stack page", () => {
  it("creates a stack with the name, template and parameter values of the form", async () => {
    open("/cloudformation/stacks/create");
    await userEvent.type(screen.getByPlaceholderText("my-stack"), "orders-stack");
    await userEvent.click(screen.getByRole("button", { name: /Sample template/ }));
    await userEvent.click(await screen.findByText("DynamoDB table"));
    const table = await screen.findByRole("textbox", { name: "TableName" });
    expect(table).toHaveValue("orders");
    await userEvent.clear(table);
    await userEvent.type(table, "invoices");
    await userEvent.click(screen.getByRole("button", { name: "Create stack" }));
    await waitFor(() => expect(sent("CreateStackCommand")).toHaveLength(1));
    expect(sent("CreateStackCommand")[0].input).toEqual({
      StackName: "orders-stack",
      TemplateBody: SAMPLES[2].yaml,
      Parameters: [
        { ParameterKey: "TableName", ParameterValue: "invoices" },
        { ParameterKey: "KeyName", ParameterValue: "id" },
      ],
      Capabilities: [],
      Tags: [],
    });
  });

  it("rejects a stack name with invalid characters", async () => {
    open("/cloudformation/stacks/create");
    await userEvent.type(screen.getByPlaceholderText("my-stack"), "bad name!");
    await userEvent.click(screen.getByRole("button", { name: "Create stack" }));
    // The form shows the error and also reads it out, so the text is in the page twice.
    expect((await screen.findAllByText(/A stack name starts with a letter/)).length).toBeGreaterThan(0);
    expect(sent("CreateStackCommand")).toHaveLength(0);
  });

  it("updates a stack and keeps the parameter values the user did not change", async () => {
    open("/cloudformation/stacks/create?update=shop");
    const table = await screen.findByRole("textbox", { name: "TableName" });
    expect(table).toHaveValue("live-orders");
    const key = screen.getByRole("textbox", { name: "KeyName" });
    await userEvent.clear(key);
    await userEvent.type(key, "pk");
    await userEvent.click(screen.getByRole("button", { name: "Update stack" }));
    await waitFor(() => expect(sent("UpdateStackCommand")).toHaveLength(1));
    expect(sent("UpdateStackCommand")[0].input).toEqual({
      StackName: "shop",
      TemplateBody: SAMPLES[2].yaml,
      Parameters: [
        { ParameterKey: "TableName", UsePreviousValue: true },
        { ParameterKey: "KeyName", ParameterValue: "pk" },
      ],
      Capabilities: [],
      Tags: [{ Key: "env", Value: "dev" }],
    });
  });
});

describe("CloudFormation helpers", () => {
  it("checks stack names", () => {
    expect(stackNameError("my-stack-1")).toBe("");
    expect(stackNameError("1stack")).not.toBe("");
    expect(stackNameError("")).not.toBe("");
  });

  it("links a resource to its console page when there is one", () => {
    expect(resourceHref("AWS::S3::Bucket", "my-bucket")).toBe("/s3/bucket?name=my-bucket");
    expect(resourceHref("AWS::DynamoDB::Table", "orders")).toBe("/dynamodb/table?name=orders");
    expect(resourceHref("AWS::SQS::Queue", "http://floci:4566/000000000000/q")).toBe(`/sqs/queue?url=${encodeURIComponent("http://floci:4566/000000000000/q")}`);
    expect(resourceHref("AWS::IAM::Role", "app-role")).toBe("/iam/roles/app-role");
    expect(resourceHref("AWS::Nope::Thing", "x")).toBeUndefined();
  });
});
