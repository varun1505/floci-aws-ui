import type { ContainerDefinition, KeyValuePair, PortMapping } from "@aws-sdk/client-ecs";
import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { getRegion } from "../../config";

const PROTOCOLS = [
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

/** The form fields of one container in the task definition editor. */
export function ContainerForm({
  index,
  value,
  family,
  onChange,
  onRemove,
}: {
  index: number;
  value: ContainerDefinition;
  family: string;
  onChange: (value: ContainerDefinition) => void;
  onRemove?: () => void;
}) {
  const set = (patch: Partial<ContainerDefinition>) => onChange({ ...value, ...patch });
  const ports = value.portMappings ?? [];
  const env = value.environment ?? [];
  const logOptions = value.logConfiguration?.options ?? {};
  const awslogs = value.logConfiguration?.logDriver === "awslogs";

  const setPort = (i: number, patch: Partial<PortMapping>) => set({ portMappings: ports.map((p, n) => (n === i ? { ...p, ...patch } : p)) });
  const setEnv = (i: number, patch: Partial<KeyValuePair>) => set({ environment: env.map((e, n) => (n === i ? { ...e, ...patch } : e)) });
  const setLogOption = (key: string, text: string) => set({ logConfiguration: { ...value.logConfiguration, logDriver: "awslogs", options: { ...logOptions, [key]: text } } });

  const toggleLogs = (on: boolean) => {
    if (!on) return set({ logConfiguration: undefined });
    set({
      logConfiguration: {
        logDriver: "awslogs",
        options: { "awslogs-group": `/ecs/${family || "my-task"}`, "awslogs-region": getRegion(), "awslogs-stream-prefix": "ecs" },
      },
    });
  };

  return (
    <Container
      header={
        <Header variant="h3" actions={onRemove && <Button onClick={onRemove}>Remove</Button>}>
          Container {index + 1}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <ColumnLayout columns={2}>
          <FormField label="Name">
            <Input value={value.name ?? ""} placeholder="web" ariaLabel={`Container ${index + 1} name`} onChange={(e) => set({ name: e.detail.value })} />
          </FormField>
          <FormField label="Image URI" description="floci pulls it with Docker. An ECR repository URI works too.">
            <Input value={value.image ?? ""} placeholder="nginx:alpine" ariaLabel={`Container ${index + 1} image`} onChange={(e) => set({ image: e.detail.value })} />
          </FormField>
        </ColumnLayout>
        <Checkbox checked={value.essential !== false} onChange={(e) => set({ essential: e.detail.checked })} description="When an essential container stops, the whole task stops.">
          Essential container
        </Checkbox>
        <FormField label="Command - optional" description="Comma separated. Replaces the CMD of the image.">
          <Input value={(value.command ?? []).join(",")} placeholder="sh,-c,echo hello" onChange={(e) => set({ command: e.detail.value ? e.detail.value.split(",") : undefined })} />
        </FormField>
        <FormField label="Port mappings - optional" stretch>
          <AttributeEditor
            items={ports}
            addButtonText="Add port mapping"
            removeButtonText="Remove"
            empty="No port mappings."
            onAddButtonClick={() => set({ portMappings: [...ports, { protocol: "tcp" }] })}
            onRemoveButtonClick={(e) => set({ portMappings: ports.filter((_, n) => n !== e.detail.itemIndex) })}
            definition={[
              {
                label: "Container port",
                control: (p, i) => <Input type="number" value={p.containerPort ? String(p.containerPort) : ""} placeholder="80" onChange={(e) => setPort(i, { containerPort: Number(e.detail.value) || undefined })} />,
              },
              {
                label: "Host port - optional",
                control: (p, i) => <Input type="number" value={p.hostPort ? String(p.hostPort) : ""} placeholder="Same as the container port" onChange={(e) => setPort(i, { hostPort: Number(e.detail.value) || undefined })} />,
              },
              {
                label: "Protocol",
                control: (p, i) => (
                  <Select
                    selectedOption={PROTOCOLS.find((o) => o.value === (p.protocol ?? "tcp")) ?? PROTOCOLS[0]}
                    options={PROTOCOLS}
                    onChange={(e) => setPort(i, { protocol: e.detail.selectedOption.value as "tcp" | "udp" })}
                  />
                ),
              },
            ]}
          />
        </FormField>
        <FormField label="Environment variables - optional" stretch>
          <AttributeEditor
            items={env}
            addButtonText="Add environment variable"
            removeButtonText="Remove"
            empty="No environment variables."
            onAddButtonClick={() => set({ environment: [...env, { name: "", value: "" }] })}
            onRemoveButtonClick={(e) => set({ environment: env.filter((_, n) => n !== e.detail.itemIndex) })}
            definition={[
              { label: "Key", control: (v, i) => <Input value={v.name ?? ""} placeholder="LOG_LEVEL" onChange={(e) => setEnv(i, { name: e.detail.value })} /> },
              { label: "Value", control: (v, i) => <Input value={v.value ?? ""} placeholder="debug" onChange={(e) => setEnv(i, { value: e.detail.value })} /> },
            ]}
          />
        </FormField>
        <Checkbox checked={awslogs} onChange={(e) => toggleLogs(e.detail.checked)} description="Sends the output of the container to CloudWatch Logs. The task page then shows it.">
          Use log collection (awslogs)
        </Checkbox>
        {awslogs && (
          <ColumnLayout columns={3}>
            <FormField label="awslogs-group">
              <Input value={logOptions["awslogs-group"] ?? ""} onChange={(e) => setLogOption("awslogs-group", e.detail.value)} />
            </FormField>
            <FormField label="awslogs-region">
              <Input value={logOptions["awslogs-region"] ?? ""} onChange={(e) => setLogOption("awslogs-region", e.detail.value)} />
            </FormField>
            <FormField label="awslogs-stream-prefix">
              <Input value={logOptions["awslogs-stream-prefix"] ?? ""} onChange={(e) => setLogOption("awslogs-stream-prefix", e.detail.value)} />
            </FormField>
          </ColumnLayout>
        )}
      </SpaceBetween>
    </Container>
  );
}
