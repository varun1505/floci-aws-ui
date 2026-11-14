import type { ContainerDefinition, RegisterTaskDefinitionCommandInput, TaskDefinition } from "@aws-sdk/client-ecs";
import { NAME_HINT, NAME_RULE } from "./ecsutil";

/** What RegisterTaskDefinition takes. The same JSON as `aws ecs register-task-definition --cli-input-json`. */
export type Def = RegisterTaskDefinitionCommandInput;

export const emptyContainer = (): ContainerDefinition => ({ name: "", image: "", essential: true });

export const emptyDef = (): Def => ({
  family: "",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "512",
  containerDefinitions: [emptyContainer()],
});

/** Turns a registered task definition back into the input for a new revision. Drops the fields ECS fills in. */
export function toInput(td: TaskDefinition): Def {
  const { taskDefinitionArn, revision, status, requiresAttributes, compatibilities, registeredAt, deregisteredAt, registeredBy, ...rest } = td;
  void [taskDefinitionArn, revision, status, requiresAttributes, compatibilities, registeredAt, deregisteredAt, registeredBy];
  return JSON.parse(JSON.stringify(rest)) as Def;
}

/** Removes what the form leaves half filled: empty rows, empty strings, blank command parts. */
export function clean(def: Def): Def {
  const out = JSON.parse(JSON.stringify(def)) as Def;
  for (const key of ["taskRoleArn", "executionRoleArn", "cpu", "memory"] as const) if (!out[key]) delete out[key];
  for (const c of out.containerDefinitions ?? []) {
    if (c.command) {
      c.command = c.command.map((part) => part.trim()).filter(Boolean);
      if (!c.command.length) delete c.command;
    }
    if (c.environment) {
      c.environment = c.environment.filter((e) => e.name);
      if (!c.environment.length) delete c.environment;
    }
    if (c.portMappings) {
      c.portMappings = c.portMappings.filter((p) => p.containerPort);
      if (!c.portMappings.length) delete c.portMappings;
    }
  }
  return out;
}

/** Reads the JSON tab. Gives the definition, or an error text. */
export function parseDef(text: string): Def | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return `The JSON is not valid: ${(e as Error).message}`;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "The JSON must be one object.";
  // Accept the output of describe-task-definition too.
  const inner = (value as { taskDefinition?: TaskDefinition }).taskDefinition;
  const def = toInput((inner ?? value) as TaskDefinition);
  if (!Array.isArray(def.containerDefinitions)) def.containerDefinitions = [];
  return def;
}

/** An error text, or an empty string when the definition can be registered. */
export function defProblem(def: Def): string {
  if (!NAME_RULE.test(def.family ?? "")) return `Task definition family: ${NAME_HINT}`;
  const containers = def.containerDefinitions ?? [];
  if (!containers.length) return "Add at least one container.";
  for (const [i, c] of containers.entries()) {
    if (!c.name || !NAME_RULE.test(c.name)) return `Container ${i + 1} needs a name. ${NAME_HINT}`;
    if (!c.image?.trim()) return `Container ${c.name} needs an image, such as nginx:alpine.`;
  }
  if (new Set(containers.map((c) => c.name)).size !== containers.length) return "Each container needs its own name.";
  if (def.requiresCompatibilities?.includes("FARGATE")) {
    if (def.networkMode !== "awsvpc") return "Fargate needs the awsvpc network mode.";
    if (!def.cpu || !def.memory) return "Fargate needs a task CPU and a task memory, such as 256 and 512.";
  }
  return "";
}
