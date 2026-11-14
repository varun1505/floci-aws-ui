import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The ECR client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/ecr", () => ({ ecr: { send } }));

import { listImages } from "./ecrutil";
import { pushCommands } from "./PushCommands";
import Repositories from "./Repositories";

const REGISTRY = "000000000000.dkr.ecr.us-east-1.localhost:4566";
let repos: string[];

beforeEach(() => {
  repos = ["team/app"];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "DescribeRepositoriesCommand":
        return {
          repositories: repos.map((name) => ({
            repositoryArn: `arn:aws:ecr:us-east-1:000000000000:repository/${name}`,
            repositoryName: name,
            repositoryUri: `${REGISTRY}/${name}`,
            imageTagMutability: "IMMUTABLE",
            imageScanningConfiguration: { scanOnPush: true },
            encryptionConfiguration: { encryptionType: "AES256" },
          })),
        };
      case "CreateRepositoryCommand":
        return { repository: { repositoryName: command.input.repositoryName } };
      case "DeleteRepositoryCommand":
        repos = repos.filter((r) => r !== command.input.repositoryName);
        return {};
      case "DescribeImagesCommand":
        return {
          imageDetails: [
            { imageDigest: "sha256:aaa", imageTags: ["v1"], imageSizeInBytes: 515 },
            { imageDigest: "sha256:aaa", imageTags: ["latest"], imageSizeInBytes: 515 },
            { imageDigest: "sha256:bbb", imageTags: ["v0"], imageSizeInBytes: 400 },
          ],
        };
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
    <MemoryRouter initialEntries={["/ecr/repositories"]}>
      <NotifyProvider>
        <Repositories />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("ECR repositories page", () => {
  it("lists the repositories with their settings", async () => {
    open();
    expect(await screen.findByRole("link", { name: "team/app" })).toHaveAttribute("href", "/ecr/repository?name=team%2Fapp");
    const row = within(screen.getByRole("link", { name: "team/app" }).closest("tr")!);
    expect(row.getByText(`${REGISTRY}/team/app`)).toBeInTheDocument();
    expect(row.getByText("Immutable")).toBeInTheDocument();
    expect(row.getByText("Enabled")).toBeInTheDocument();
    expect(row.getByText("AES-256")).toBeInTheDocument();
  });

  it("creates a repository with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "team/app" });
    await userEvent.click(pageButton("Create repository"));
    await userEvent.type(await screen.findByPlaceholderText("my-app"), "team/api");
    await userEvent.click(screen.getByRole("radio", { name: /Immutable/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Scan on push/ }));
    await userEvent.click(dialogButton("Create"));
    await waitFor(() => expect(sent("CreateRepositoryCommand")).toHaveLength(1));
    expect(sent("CreateRepositoryCommand")[0].input).toEqual({ repositoryName: "team/api", imageTagMutability: "IMMUTABLE", imageScanningConfiguration: { scanOnPush: true } });
  });

  it("rejects a repository name with invalid characters", async () => {
    open();
    await screen.findByRole("link", { name: "team/app" });
    await userEvent.click(pageButton("Create repository"));
    await userEvent.type(await screen.findByPlaceholderText("my-app"), "Bad/Name");
    await userEvent.click(dialogButton("Create"));
    expect(await screen.findAllByText(/^Use 2 to 256 lowercase letters/)).toHaveLength(2);
    expect(sent("CreateRepositoryCommand")).toHaveLength(0);
  });

  it("deletes the selected repository with its images only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "team/app" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(within(screen.getByRole("link", { name: "team/app" }).closest("tr")!).getByRole("checkbox"));
    await userEvent.click(del);
    expect(sent("DeleteRepositoryCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteRepositoryCommand")).toHaveLength(1));
    expect(sent("DeleteRepositoryCommand")[0].input).toEqual({ repositoryName: "team/app", force: true });
    await waitFor(() => expect(screen.queryByRole("link", { name: "team/app" })).not.toBeInTheDocument());
  });
});

describe("ECR helpers", () => {
  it("joins the entries floci returns per tag into one image per digest", async () => {
    const images = await listImages("team/app");
    expect(images.map((i) => [i.imageDigest, i.imageTags])).toEqual([
      ["sha256:aaa", ["v1", "latest"]],
      ["sha256:bbb", ["v0"]],
    ]);
  });

  it("builds push commands from the repository URI", () => {
    const { registry, steps } = pushCommands("team/app", `${REGISTRY}/team/app`, "us-east-1");
    expect(registry).toBe(REGISTRY);
    expect(steps.map((s) => s.command)).toEqual([
      `aws --profile floci ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${REGISTRY}`,
      "docker build -t app .",
      `docker tag app:latest ${REGISTRY}/team/app:latest`,
      `docker push ${REGISTRY}/team/app:latest`,
    ]);
  });
});
