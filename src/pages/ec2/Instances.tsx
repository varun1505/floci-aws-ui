import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  RebootInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  type Instance,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { InstanceState, TRANSITIONAL, listInstances, tagName } from "./ec2util";

/** Runs a state change (start, stop, reboot, terminate) on instances. Shared with the detail page. */
export async function changeState(action: string, ids: string[]) {
  if (action === "start") await ec2.send(new StartInstancesCommand({ InstanceIds: ids }));
  if (action === "stop") await ec2.send(new StopInstancesCommand({ InstanceIds: ids }));
  if (action === "reboot") await ec2.send(new RebootInstancesCommand({ InstanceIds: ids }));
  if (action === "terminate") await ec2.send(new TerminateInstancesCommand({ InstanceIds: ids }));
}

export const STATE_VERB: Record<string, string> = {
  start: "Successfully started",
  stop: "Successfully stopped",
  reboot: "Successfully rebooted",
  terminate: "Successfully initiated termination of",
};

export default function Instances() {
  const navigate = useNavigate();
  const notify = useNotify();
  const instances = useLoad(() => listInstances(), []);
  const [selected, setSelected] = useState<Instance[]>([]);
  const [terminating, setTerminating] = useState(false);

  // Keep refreshing while an instance is changing state.
  const moving = (instances.data ?? []).some((i) => TRANSITIONAL.includes(i.State?.Name ?? ""));
  useEffect(() => {
    if (!moving) return;
    const id = setInterval(() => instances.reload(true), 2500);
    return () => clearInterval(id);
  }, [moving, instances.reload]);

  // Selection holds old copies of the rows. Show the live state for them.
  const live = selected.map((s) => instances.data?.find((i) => i.InstanceId === s.InstanceId) ?? s);
  const ids = live.map((i) => i.InstanceId ?? "");
  const states = live.map((i) => i.State?.Name);
  const all = (state: string) => live.length > 0 && states.every((s) => s === state);

  const run = async (action: string) => {
    try {
      await changeState(action, ids);
      notify.success(`${STATE_VERB[action]} ${ids.join(", ")}.`);
    } catch (e) {
      notify.error(`Could not ${action} the instance`, e);
    }
    setTerminating(false);
    instances.reload(true);
    // The emulator can take a moment to report the new state. Check again shortly.
    setTimeout(() => instances.reload(true), 2000);
    setTimeout(() => instances.reload(true), 6000);
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/instances" }, { text: "Instances", href: "/ec2/instances" }]}>
      <ResourceTable
        title="Instances"
        resourceName="instances"
        filterPlaceholder="Find instance by attribute or tag"
        items={instances.data}
        loading={instances.loading}
        error={instances.error}
        onRefresh={() => instances.reload()}
        trackBy={(i) => i.InstanceId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => navigate("/ec2/instances/launch")}>Launch instances</Button>}
        actions={
          <>
            <ButtonDropdown
              disabled={live.length === 0}
              items={[
                { id: "stop", text: "Stop instance", disabled: !all("running") },
                { id: "start", text: "Start instance", disabled: !all("stopped") },
                { id: "reboot", text: "Reboot instance", disabled: !all("running") },
                { id: "terminate", text: "Terminate (delete) instance", disabled: states.some((s) => s === "terminated" || s === "shutting-down") },
              ]}
              onItemClick={(e) => (e.detail.id === "terminate" ? setTerminating(true) : run(e.detail.id))}
            >
              Instance state
            </ButtonDropdown>
            <Button variant="primary" onClick={() => navigate("/ec2/instances/launch")}>
              Launch instances
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (i) => tagName(i.Tags) || "-" },
          {
            id: "id",
            header: "Instance ID",
            cell: (i) => <RouterLink to={`/ec2/instances/${i.InstanceId}`}>{i.InstanceId}</RouterLink>,
            sortingField: "InstanceId",
            isRowHeader: true,
          },
          { id: "state", header: "Instance state", cell: (i) => <InstanceState state={i.State?.Name} /> },
          { id: "type", header: "Instance type", cell: (i) => i.InstanceType ?? "-", sortingField: "InstanceType" },
          { id: "az", header: "Availability Zone", cell: (i) => i.Placement?.AvailabilityZone ?? "-" },
          { id: "public", header: "Public IPv4 address", cell: (i) => i.PublicIpAddress ?? "-" },
          { id: "private", header: "Private IP address", cell: (i) => i.PrivateIpAddress ?? "-" },
          { id: "key", header: "Key name", cell: (i) => i.KeyName ?? "-" },
          { id: "launch", header: "Launch time", cell: (i) => formatDate(i.LaunchTime), sortingField: "LaunchTime" },
        ]}
      />
      <ConfirmDelete
        visible={terminating}
        title={`Terminate (delete) instance${ids.length === 1 ? "" : "s"}?`}
        confirmText="terminate"
        actionLabel="Terminate (delete)"
        onCancel={() => setTerminating(false)}
        onConfirm={() => run("terminate")}
        warning="On an EBS-backed instance, the default action is for the root EBS volume to be deleted when the instance is terminated. Storage on any local drives will be lost."
      >
        <Box>{ids.join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
