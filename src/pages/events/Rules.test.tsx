import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The EventBridge client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/eventbridge", () => ({ eventbridge: { send } }));
// The real code editor needs a browser. A plain text box stands in for it.
vi.mock("../../components/Code", () => ({
  Code: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import Rules from "./Rules";
import { SAMPLE_PATTERNS } from "./eventsutil";

type Rule = { Name: string; State: string; EventBusName: string; EventPattern?: string; ScheduleExpression?: string; Description?: string };
let rules: Rule[];

beforeEach(() => {
  rules = [
    { Name: "orders-rule", State: "ENABLED", EventBusName: "default", EventPattern: '{"source":["my.app"]}', Description: "Order events" },
    { Name: "nightly", State: "DISABLED", EventBusName: "default", ScheduleExpression: "rate(1 day)" },
  ];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListEventBusesCommand":
        return { EventBuses: [{ Name: "audit" }, { Name: "default" }] };
      case "ListRulesCommand":
        return { Rules: command.input.EventBusName === "default" ? rules : [] };
      case "PutRuleCommand":
        return { RuleArn: `arn:aws:events:us-east-1:000000000000:rule/${command.input.Name}` };
      case "ListTargetsByRuleCommand":
        return { Targets: [{ Id: "queue", Arn: "arn:aws:sqs:us-east-1:000000000000:orders" }] };
      case "RemoveTargetsCommand":
        return { FailedEntryCount: 0 };
      case "DeleteRuleCommand":
        rules = rules.filter((r) => r.Name !== command.input.Name);
        return {};
      case "EnableRuleCommand":
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
const rowOf = (name: string) => within(screen.getByRole("link", { name }).closest("tr")!);

function open() {
  render(
    <MemoryRouter initialEntries={["/events/rules"]}>
      <NotifyProvider>
        <Rules />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("EventBridge rules page", () => {
  it("lists the rules of the default bus with status and type", async () => {
    open();
    expect(await screen.findByRole("link", { name: "orders-rule" })).toHaveAttribute("href", "/events/rule?name=orders-rule&bus=default");
    expect(sent("ListRulesCommand")[0].input).toMatchObject({ EventBusName: "default" });
    expect(rowOf("orders-rule").getByText("Enabled")).toBeInTheDocument();
    expect(rowOf("orders-rule").getByText("Standard")).toBeInTheDocument();
    expect(rowOf("nightly").getByText("Disabled")).toBeInTheDocument();
    expect(rowOf("nightly").getByText("Scheduled")).toBeInTheDocument();
    expect(rowOf("nightly").getByText("rate(1 day)")).toBeInTheDocument();
  });

  it("creates a rule with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "orders-rule" });
    await userEvent.click(pageButton("Create rule"));
    await userEvent.type(await screen.findByPlaceholderText("my-rule"), "invoices");
    await userEvent.click(dialogButton("Create rule"));
    await waitFor(() => expect(sent("PutRuleCommand")).toHaveLength(1));
    expect(sent("PutRuleCommand")[0].input).toEqual({ Name: "invoices", EventBusName: "default", EventPattern: SAMPLE_PATTERNS[0].pattern, State: "ENABLED" });
  });

  it("rejects an event pattern that is not JSON", async () => {
    open();
    await screen.findByRole("link", { name: "orders-rule" });
    await userEvent.click(pageButton("Create rule"));
    await userEvent.type(await screen.findByPlaceholderText("my-rule"), "invoices");
    const editor = await screen.findByLabelText("Event pattern");
    await userEvent.clear(editor);
    await userEvent.type(editor, "not json");
    await userEvent.click(dialogButton("Create rule"));
    expect(await screen.findByText(/The event pattern is not valid JSON/)).toBeInTheDocument();
    expect(sent("PutRuleCommand")).toHaveLength(0);
  });

  it("enables a disabled rule", async () => {
    open();
    await screen.findByRole("link", { name: "nightly" });
    await userEvent.click(rowOf("nightly").getByRole("checkbox"));
    await userEvent.click(pageButton("Enable"));
    await waitFor(() => expect(sent("EnableRuleCommand")).toHaveLength(1));
    expect(sent("EnableRuleCommand")[0].input).toEqual({ Name: "nightly", EventBusName: "default" });
  });

  it("removes the targets, then deletes the rule, only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "orders-rule" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(rowOf("orders-rule").getByRole("checkbox"));
    await userEvent.click(del);
    expect(sent("DeleteRuleCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteRuleCommand")).toHaveLength(1));
    expect(sent("RemoveTargetsCommand")[0].input).toEqual({ Rule: "orders-rule", EventBusName: "default", Ids: ["queue"] });
    expect(sent("DeleteRuleCommand")[0].input).toEqual({ Name: "orders-rule", EventBusName: "default" });
    expect(send.mock.calls.findIndex(([c]) => c.constructor.name === "RemoveTargetsCommand")).toBeLessThan(send.mock.calls.findIndex(([c]) => c.constructor.name === "DeleteRuleCommand"));
    await waitFor(() => expect(screen.queryByRole("link", { name: "orders-rule" })).not.toBeInTheDocument());
  });
});
