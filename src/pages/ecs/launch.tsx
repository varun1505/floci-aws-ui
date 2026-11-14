import { useEffect, useState } from "react";
import { DescribeSecurityGroupsCommand, DescribeSubnetsCommand, type SecurityGroup, type Subnet } from "@aws-sdk/client-ec2";
import { DescribeTaskDefinitionCommand, type NetworkConfiguration } from "@aws-sdk/client-ecs";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Multiselect from "@cloudscape-design/components/multiselect";
import Select from "@cloudscape-design/components/select";
import { ec2 } from "../../clients/ec2";
import { ecs } from "../../clients/ecs";
import { useLoad } from "../../lib/useLoad";
import { listClusters, listTaskDefArns, splitTaskDef } from "./ecsutil";

// The parts that the "Run task" and "Create service" dialogs share:
// pick a cluster, pick a task definition revision, pick a launch type and the network.

export type LaunchType = "FARGATE" | "EC2";

async function loadNetwork() {
  const subnets: Subnet[] = [];
  const groups: SecurityGroup[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeSubnetsCommand({ NextToken }));
    subnets.push(...(res.Subnets ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  do {
    const res = await ec2.send(new DescribeSecurityGroupsCommand({ NextToken }));
    groups.push(...(res.SecurityGroups ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return { subnets, groups };
}

/** State of the launch type and network fields for one task definition (family:revision). */
export function useLaunch(taskDef: string) {
  const def = useLoad(async () => (taskDef ? (await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: taskDef }))).taskDefinition : undefined), [taskDef]);
  const network = useLoad(loadNetwork, []);
  const [launchType, setLaunchType] = useState<LaunchType>("FARGATE");
  const [subnets, setSubnets] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [publicIp, setPublicIp] = useState(true);
  const awsvpc = !!taskDef && def.data?.networkMode === "awsvpc";

  // A task definition made for Fargate starts on Fargate. Anything else starts on EC2.
  useEffect(() => {
    if (def.data) setLaunchType(def.data.requiresCompatibilities?.includes("FARGATE") ? "FARGATE" : "EC2");
  }, [def.data]);

  return {
    def: taskDef ? def.data : undefined,
    network: network.data,
    awsvpc,
    launchType,
    setLaunchType,
    subnets,
    setSubnets,
    groups,
    setGroups,
    publicIp,
    setPublicIp,
    /** An error text, or an empty string when the fields are complete. */
    problem: () => (awsvpc && !subnets.length ? "Choose at least one subnet. This task definition uses the awsvpc network mode." : ""),
    networkConfiguration: (): NetworkConfiguration | undefined => {
      if (!awsvpc) return undefined;
      return {
        awsvpcConfiguration: {
          subnets,
          securityGroups: groups.length ? groups : undefined,
          assignPublicIp: launchType === "FARGATE" ? (publicIp ? "ENABLED" : "DISABLED") : undefined,
        },
      };
    },
  };
}

const LAUNCH_OPTIONS = [
  { value: "FARGATE", label: "FARGATE" },
  { value: "EC2", label: "EC2" },
];

export function LaunchFields({ launch }: { launch: ReturnType<typeof useLaunch> }) {
  const subnetOptions = (launch.network?.subnets ?? []).map((s) => ({ value: s.SubnetId ?? "", label: s.SubnetId ?? "", description: `${s.VpcId} | ${s.AvailabilityZone} | ${s.CidrBlock}` }));
  const groupOptions = (launch.network?.groups ?? []).map((g) => ({ value: g.GroupId ?? "", label: g.GroupId ?? "", description: `${g.GroupName} | ${g.VpcId}` }));
  return (
    <>
      <FormField label="Launch type" description="floci runs every task as Docker containers on its host, whatever the launch type.">
        <Select
          selectedOption={LAUNCH_OPTIONS.find((o) => o.value === launch.launchType) ?? null}
          options={LAUNCH_OPTIONS}
          onChange={(e) => launch.setLaunchType(e.detail.selectedOption.value as LaunchType)}
        />
      </FormField>
      {launch.awsvpc && (
        <>
          <ColumnLayout columns={2}>
            <FormField label="Subnets" description="The task gets a network interface in one of them.">
              <Multiselect
                selectedOptions={subnetOptions.filter((o) => launch.subnets.includes(o.value))}
                options={subnetOptions}
                placeholder="Choose subnets"
                empty="No subnets"
                onChange={(e) => launch.setSubnets(e.detail.selectedOptions.map((o) => o.value ?? ""))}
              />
            </FormField>
            <FormField label="Security groups - optional">
              <Multiselect
                selectedOptions={groupOptions.filter((o) => launch.groups.includes(o.value))}
                options={groupOptions}
                placeholder="Choose security groups"
                empty="No security groups"
                onChange={(e) => launch.setGroups(e.detail.selectedOptions.map((o) => o.value ?? ""))}
              />
            </FormField>
          </ColumnLayout>
          {launch.launchType === "FARGATE" && (
            <Checkbox checked={launch.publicIp} onChange={(e) => launch.setPublicIp(e.detail.checked)}>
              Assign a public IP
            </Checkbox>
          )}
        </>
      )}
    </>
  );
}

/** Two selects: the family, then one of its active revisions. The value is family:revision. */
export function TaskDefPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const arns = useLoad(() => listTaskDefArns("ACTIVE"), []);
  const all = (arns.data ?? []).map(splitTaskDef);
  const families = [...new Set(all.map((d) => d.family))].sort();
  const current = splitTaskDef(value);
  const revisions = all
    .filter((d) => d.family === current.family)
    .map((d) => d.revision)
    .sort((a, b) => b - a);
  const latest = (family: string) => Math.max(...all.filter((d) => d.family === family).map((d) => d.revision));
  return (
    <ColumnLayout columns={2}>
      <FormField label="Task definition family">
        <Select
          selectedOption={current.family ? { value: current.family, label: current.family } : null}
          options={families.map((f) => ({ value: f, label: f }))}
          placeholder="Choose a family"
          empty="No active task definitions"
          statusType={arns.loading ? "loading" : arns.error ? "error" : "finished"}
          errorText={arns.error}
          filteringType="auto"
          onChange={(e) => onChange(`${e.detail.selectedOption.value}:${latest(e.detail.selectedOption.value ?? "")}`)}
        />
      </FormField>
      <FormField label="Revision">
        <Select
          selectedOption={current.revision ? { value: String(current.revision), label: `${current.revision}${current.revision === revisions[0] ? " (LATEST)" : ""}` } : null}
          options={revisions.map((r, i) => ({ value: String(r), label: `${r}${i === 0 ? " (LATEST)" : ""}` }))}
          placeholder="Choose a revision"
          disabled={!current.family}
          onChange={(e) => onChange(`${current.family}:${e.detail.selectedOption.value}`)}
        />
      </FormField>
    </ColumnLayout>
  );
}

export function ClusterPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const clusters = useLoad(listClusters, []);
  return (
    <FormField label="Cluster">
      <Select
        selectedOption={value ? { value, label: value } : null}
        options={(clusters.data ?? []).map((c) => ({ value: c.clusterName ?? "", label: c.clusterName ?? "" }))}
        placeholder="Choose a cluster"
        empty="No clusters. Create a cluster first."
        statusType={clusters.loading ? "loading" : "finished"}
        onChange={(e) => onChange(e.detail.selectedOption.value ?? "")}
      />
    </FormField>
  );
}
