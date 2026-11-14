import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDefinition } from "@aws-sdk/client-ecs";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The ECS client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/ecs", () => ({ ecs: { send } }));

import Clusters from "./Clusters";
import { splitCommand } from "./RunTaskModal";
import { logTargets } from "./TaskDetail";
import { clean, defProblem, emptyDef, parseDef, toInput } from "./taskdef";

const arn = (name: string) => `arn:aws:ecs:us-east-1:000000000000:cluster/${name}`;
let clusters: string[];
let deleteError: Error | undefined;

beforeEach(() => {
  clusters = ["web"];
  deleteError = undefined;
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListClustersCommand":
        return { clusterArns: clusters.map(arn) };
      case "DescribeClustersCommand":
        return {
          clusters: (command.input.clusters as string[]).map((a) => ({ clusterArn: a, clusterName: a.split("/").pop(), status: "ACTIVE", activeServicesCount: 2, runningTasksCount: 5, pendingTasksCount: 1 })),
        };
      case "CreateClusterCommand":
        clusters.push(command.input.clusterName as string);
        return { cluster: { clusterName: command.input.clusterName } };
      case "DeleteClusterCommand":
        if (deleteError) throw deleteError;
        clusters = clusters.filter((c) => c !== command.input.cluster);
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
    <MemoryRouter initialEntries={["/ecs/clusters"]}>
      <NotifyProvider>
        <Clusters />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

async function chooseWeb() {
  await screen.findByRole("link", { name: "web" });
  await userEvent.click(screen.getAllByRole("radio").at(-1)!);
}

describe("ECS clusters page", () => {
  it("lists the clusters with their counts", async () => {
    open();
    expect(await screen.findByRole("link", { name: "web" })).toHaveAttribute("href", "/ecs/clusters/web");
    const row = within(screen.getByRole("link", { name: "web" }).closest("tr")!);
    expect(row.getByText("Active")).toBeInTheDocument();
    expect(row.getByText("2")).toBeInTheDocument();
    expect(row.getByText("5")).toBeInTheDocument();
    expect(row.getByText("1")).toBeInTheDocument();
  });

  it("creates a cluster with the name of the form", async () => {
    open();
    await screen.findByRole("link", { name: "web" });
    await userEvent.click(pageButton("Create cluster"));
    await userEvent.type(await screen.findByPlaceholderText("my-cluster"), "batch");
    await userEvent.click(dialogButton("Create"));
    await waitFor(() => expect(sent("CreateClusterCommand")).toHaveLength(1));
    expect(sent("CreateClusterCommand")[0].input).toEqual({ clusterName: "batch" });
  });

  it("rejects a bad name and a name that is taken", async () => {
    open();
    await screen.findByRole("link", { name: "web" });
    await userEvent.click(pageButton("Create cluster"));
    const input = await screen.findByPlaceholderText("my-cluster");
    await userEvent.type(input, "bad name");
    await userEvent.click(dialogButton("Create"));
    expect(await screen.findAllByText("Use up to 255 letters, numbers, hyphens and underscores.")).toHaveLength(2);
    await userEvent.clear(input);
    await userEvent.type(input, "web");
    await userEvent.click(dialogButton("Create"));
    expect(await screen.findByText("A cluster named web already exists.")).toBeInTheDocument();
    expect(sent("CreateClusterCommand")).toHaveLength(0);
  });

  it("deletes the selected cluster only after the user confirms", async () => {
    open();
    expect(pageButton("Delete")).toBeDisabled();
    await chooseWeb();
    await userEvent.click(pageButton("Delete"));
    expect(sent("DeleteClusterCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteClusterCommand")).toHaveLength(1));
    expect(sent("DeleteClusterCommand")[0].input).toEqual({ cluster: "web" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "web" })).not.toBeInTheDocument());
  });

  it("says why a cluster with services can't be deleted", async () => {
    deleteError = Object.assign(new Error("The cluster cannot be deleted while services are active."), { name: "ClusterContainsServicesException" });
    open();
    await chooseWeb();
    await userEvent.click(pageButton("Delete"));
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteClusterCommand")).toHaveLength(1));
    expect(await screen.findByText(/The cluster still has services\. Delete them first\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "web" })).toBeInTheDocument();
  });
});

describe("ECS helpers", () => {
  it("splits a comma separated command", () => {
    expect(splitCommand("sh, -c ,echo hi; sleep 5")).toEqual(["sh", "-c", "echo hi; sleep 5"]);
    expect(splitCommand("  ")).toEqual([]);
  });

  it("finds the log stream of a container that uses awslogs", () => {
    const task = { taskArn: "arn:aws:ecs:us-east-1:000000000000:task/web/abc123", containers: [{ name: "plain", runtimeId: "docker-id" }] };
    const def: TaskDefinition = {
      containerDefinitions: [
        { name: "main", logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": "/ecs/web", "awslogs-region": "us-east-1", "awslogs-stream-prefix": "ecs" } } },
        { name: "plain", logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": "/ecs/web" } } },
        { name: "quiet" },
      ],
    };
    expect(logTargets(task, def).map((t) => [t.container, t.group, t.stream])).toEqual([
      ["main", "/ecs/web", "ecs/main/abc123"],
      ["plain", "/ecs/web", "docker-id"],
    ]);
  });

  it("turns a registered task definition into the input for a new revision", () => {
    const input = toInput({ taskDefinitionArn: "arn", revision: 3, status: "ACTIVE", compatibilities: ["EC2"], registeredAt: new Date(), family: "web", containerDefinitions: [{ name: "main", image: "nginx" }] });
    expect(input).toEqual({ family: "web", containerDefinitions: [{ name: "main", image: "nginx" }] });
    expect(parseDef(JSON.stringify({ taskDefinition: { family: "web", revision: 2, containerDefinitions: [] } }))).toEqual({ family: "web", containerDefinitions: [] });
    expect(parseDef("{")).toMatch(/^The JSON is not valid/);
  });

  it("drops half filled rows and checks the definition", () => {
    const def = emptyDef();
    expect(defProblem(def)).toMatch(/family/);
    def.family = "web";
    def.containerDefinitions = [{ name: "main", image: "nginx:alpine", command: ["sh", " -c", ""], environment: [{ name: "", value: "x" }], portMappings: [{ protocol: "tcp" }, { containerPort: 80 }] }];
    expect(clean(def).containerDefinitions).toEqual([{ name: "main", image: "nginx:alpine", command: ["sh", "-c"], portMappings: [{ containerPort: 80 }] }]);
    expect(defProblem(clean(def))).toBe("");
    expect(defProblem({ ...def, networkMode: "bridge" })).toBe("Fargate needs the awsvpc network mode.");
  });
});
