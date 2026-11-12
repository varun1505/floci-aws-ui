import { DescribeDBSubnetGroupsCommand } from "@aws-sdk/client-rds";
import { rds } from "../../clients/rds";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { useLoad } from "../../lib/useLoad";

export default function SubnetGroups() {
  const groups = useLoad(async () => (await rds.send(new DescribeDBSubnetGroupsCommand({}))).DBSubnetGroups ?? [], []);
  return (
    <Shell service="rds" contentType="table" breadcrumbs={[{ text: "RDS", href: "/rds/databases" }, { text: "Subnet groups", href: "/rds/subnet-groups" }]}>
      <ResourceTable
        title="Subnet groups"
        resourceName="subnet groups"
        items={groups.data}
        loading={groups.loading}
        error={groups.error}
        onRefresh={() => groups.reload()}
        trackBy={(g) => g.DBSubnetGroupName ?? ""}
        columns={[
          { id: "name", header: "Name", cell: (g) => g.DBSubnetGroupName, sortingField: "DBSubnetGroupName", isRowHeader: true },
          { id: "description", header: "Description", cell: (g) => g.DBSubnetGroupDescription ?? "-" },
          { id: "status", header: "Status", cell: (g) => g.SubnetGroupStatus ?? "-" },
          { id: "vpc", header: "VPC", cell: (g) => g.VpcId ?? "-" },
          { id: "subnets", header: "Subnets", cell: (g) => g.Subnets?.map((s) => s.SubnetIdentifier).join(", ") || "-" },
        ]}
      />
    </Shell>
  );
}
