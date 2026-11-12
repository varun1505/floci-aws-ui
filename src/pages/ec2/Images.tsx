import { DescribeImagesCommand } from "@aws-sdk/client-ec2";
import { ec2 } from "../../clients/ec2";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { useLoad } from "../../lib/useLoad";

export default function Images() {
  const images = useLoad(async () => (await ec2.send(new DescribeImagesCommand({}))).Images ?? [], []);
  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/instances" }, { text: "AMIs", href: "/ec2/images" }]}>
      <ResourceTable
        title="Amazon Machine Images (AMIs)"
        resourceName="AMIs"
        filterPlaceholder="Find AMI by attribute or tag"
        items={images.data}
        loading={images.loading}
        error={images.error}
        onRefresh={() => images.reload()}
        trackBy={(i) => i.ImageId ?? ""}
        columns={[
          { id: "name", header: "AMI name", cell: (i) => i.Name ?? "-", sortingField: "Name" },
          { id: "id", header: "AMI ID", cell: (i) => i.ImageId, sortingField: "ImageId", isRowHeader: true },
          { id: "arch", header: "Architecture", cell: (i) => i.Architecture ?? "-" },
          { id: "platform", header: "Platform", cell: (i) => i.PlatformDetails ?? "-" },
          { id: "root", header: "Root device type", cell: (i) => i.RootDeviceType ?? "-" },
          { id: "state", header: "Status", cell: (i) => i.State ?? "-" },
          { id: "owner", header: "Owner", cell: (i) => i.OwnerId ?? "-" },
        ]}
      />
    </Shell>
  );
}
