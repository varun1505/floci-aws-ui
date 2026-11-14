import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The Step Functions and IAM clients answer from these fakes.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/sfn", () => ({ sfn: { send } }));
vi.mock("../../clients/iam", () => ({ iam: { send: async () => ({ Roles: [{ RoleName: "workflow-role", Arn: "arn:aws:iam::000000000000:role/workflow-role" }] }) } }));
// The real code editor needs a browser. A plain text box stands in for it.
vi.mock("../../components/Code", () => ({
  Code: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import StateMachines from "./StateMachines";
import { TEMPLATES } from "./sfnutil";

const ARN = "arn:aws:states:us-east-1:000000000000:stateMachine:";
const ROLE = "arn:aws:iam::000000000000:role/workflow-role";
let machines: { stateMachineArn: string; name: string; type: string; creationDate: Date }[];

beforeEach(() => {
  machines = [
    { stateMachineArn: `${ARN}orders`, name: "orders", type: "STANDARD", creationDate: new Date("2026-01-01T10:00:00Z") },
    { stateMachineArn: `${ARN}fast`, name: "fast", type: "EXPRESS", creationDate: new Date("2026-01-02T10:00:00Z") },
  ];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListStateMachinesCommand":
        return { stateMachines: machines };
      case "DescribeStateMachineCommand":
        return { status: "ACTIVE" };
      case "CreateStateMachineCommand":
        return { stateMachineArn: `${ARN}${command.input.name}` };
      case "DeleteStateMachineCommand":
        machines = machines.filter((m) => m.stateMachineArn !== command.input.stateMachineArn);
        return {};
      default:
        throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  });
});

const sent = (name: string) => send.mock.calls.map(([c]) => c).filter((c) => c.constructor.name === name);
const pageButton = (name: string) => screen.getAllByRole("button", { name })[0];
const dialogButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;
const rowOf = (name: string) => within(screen.getByRole("link", { name }).closest("tr")!);

function open() {
  render(
    <MemoryRouter initialEntries={["/states/state-machines"]}>
      <NotifyProvider>
        <StateMachines />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("Step Functions state machines page", () => {
  it("lists the state machines with type and status", async () => {
    open();
    expect(await screen.findByRole("link", { name: "orders" })).toHaveAttribute("href", `/states/state-machine?arn=${encodeURIComponent(`${ARN}orders`)}`);
    expect(rowOf("orders").getByText("Standard")).toBeInTheDocument();
    expect(rowOf("orders").getByText("Active")).toBeInTheDocument();
    expect(rowOf("fast").getByText("Express")).toBeInTheDocument();
  });

  it("creates a state machine with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create state machine"));
    await userEvent.type(await screen.findByPlaceholderText("MyStateMachine"), "invoices");
    // Paste the ARN. Typing it one key at a time is slow.
    await userEvent.click(screen.getByPlaceholderText("arn:aws:iam::000000000000:role/my-role"));
    await userEvent.paste(ROLE);
    await userEvent.click(dialogButton("Create state machine"));
    await waitFor(() => expect(sent("CreateStateMachineCommand")).toHaveLength(1));
    expect(sent("CreateStateMachineCommand")[0].input).toEqual({ name: "invoices", type: "STANDARD", definition: TEMPLATES[0].definition, roleArn: ROLE });
    expect(JSON.parse(TEMPLATES[0].definition).States.Hello.Type).toBe("Pass");
  });

  it("rejects a definition that is not JSON", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create state machine"));
    await userEvent.type(await screen.findByPlaceholderText("MyStateMachine"), "invoices");
    const editor = screen.getByLabelText("Definition");
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste("not json");
    await userEvent.click(dialogButton("Create state machine"));
    expect(await screen.findByText(/The definition is not valid JSON/)).toBeInTheDocument();
    expect(sent("CreateStateMachineCommand")).toHaveLength(0);
  });

  it("asks for an execution role", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create state machine"));
    await userEvent.type(await screen.findByPlaceholderText("MyStateMachine"), "invoices");
    await userEvent.click(dialogButton("Create state machine"));
    expect(await screen.findByText(/Choose an execution role/)).toBeInTheDocument();
    expect(sent("CreateStateMachineCommand")).toHaveLength(0);
  });

  it("deletes the selected state machine only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(rowOf("orders").getByRole("checkbox"));
    await userEvent.click(del);
    expect(sent("DeleteStateMachineCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteStateMachineCommand")).toHaveLength(1));
    expect(sent("DeleteStateMachineCommand")[0].input).toEqual({ stateMachineArn: `${ARN}orders` });
    await waitFor(() => expect(screen.queryByRole("link", { name: "orders" })).not.toBeInTheDocument());
  });
});
