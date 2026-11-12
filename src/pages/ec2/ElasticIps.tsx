import { useState } from "react";
import { AllocateAddressCommand, DescribeAddressesCommand, ReleaseAddressCommand, type Address } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { tagName } from "./ec2util";

export default function ElasticIps() {
  const notify = useNotify();
  const addresses = useLoad(async () => (await ec2.send(new DescribeAddressesCommand({}))).Addresses ?? [], []);
  const [selected, setSelected] = useState<Address[]>([]);
  const [releasing, setReleasing] = useState(false);
  const [busy, setBusy] = useState(false);

  const allocate = async () => {
    setBusy(true);
    try {
      const res = await ec2.send(new AllocateAddressCommand({ Domain: "vpc" }));
      notify.success(`Elastic IP address allocated successfully. ${res.PublicIp ?? ""}`);
      addresses.reload();
    } catch (e) {
      notify.error("Could not allocate an Elastic IP address", e);
    }
    setBusy(false);
  };

  const release = async () => {
    try {
      for (const a of selected) await ec2.send(new ReleaseAddressCommand({ AllocationId: a.AllocationId }));
      notify.success(`Released ${selected.length} Elastic IP address${selected.length === 1 ? "" : "es"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not release the Elastic IP address", e);
    }
    setReleasing(false);
    addresses.reload();
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Elastic IP addresses", href: "/ec2/elastic-ips" }]}>
      <ResourceTable
        title="Elastic IP addresses"
        resourceName="Elastic IP addresses"
        items={addresses.data}
        loading={addresses.loading}
        error={addresses.error}
        onRefresh={() => addresses.reload()}
        trackBy={(a) => a.AllocationId ?? a.PublicIp ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={
          <Button loading={busy} onClick={allocate}>
            Allocate Elastic IP address
          </Button>
        }
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setReleasing(true)}>
              Release
            </Button>
            <Button variant="primary" loading={busy} onClick={allocate}>
              Allocate Elastic IP address
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (a) => tagName(a.Tags) || "-" },
          { id: "ip", header: "Allocated IPv4 address", cell: (a) => a.PublicIp, sortingField: "PublicIp", isRowHeader: true },
          { id: "type", header: "Type", cell: (a) => a.Domain ?? "-" },
          { id: "allocation", header: "Allocation ID", cell: (a) => a.AllocationId ?? "-" },
          { id: "instance", header: "Associated instance ID", cell: (a) => (a.InstanceId ? <RouterLink to={`/ec2/instances/${a.InstanceId}`}>{a.InstanceId}</RouterLink> : "-") },
          { id: "private", header: "Private IP address", cell: (a) => a.PrivateIpAddress ?? "-" },
        ]}
      />
      <ConfirmDelete visible={releasing} title="Release Elastic IP addresses" confirmText="release" actionLabel="Release" onCancel={() => setReleasing(false)} onConfirm={release}>
        <Box>{selected.map((a) => a.PublicIp).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
