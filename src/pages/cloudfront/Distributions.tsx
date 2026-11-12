import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteDistributionCommand, GetDistributionConfigCommand, ListDistributionsCommand, type DistributionSummary } from "@aws-sdk/client-cloudfront";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import { cloudfront } from "../../clients/cloudfront";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { EnabledStatus, setEnabled } from "./cfutil";

export async function listDistributions(): Promise<DistributionSummary[]> {
  const out: DistributionSummary[] = [];
  let Marker: string | undefined;
  do {
    const res = await cloudfront.send(new ListDistributionsCommand({ Marker }));
    out.push(...(res.DistributionList?.Items ?? []));
    Marker = res.DistributionList?.IsTruncated ? res.DistributionList.NextMarker : undefined;
  } while (Marker);
  return out;
}

export default function Distributions() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listDistributions, []);
  const [selected, setSelected] = useState<DistributionSummary[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const live = selected.map((s) => list.data?.find((d) => d.Id === s.Id)).filter(Boolean) as DistributionSummary[];
  const ids = live.map((d) => d.Id ?? "");

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      for (const id of ids) await setEnabled(id, enabled);
      notify.success(`${enabled ? "Enabled" : "Disabled"} ${ids.join(", ")}.`);
    } catch (e) {
      notify.error(`Could not ${enabled ? "enable" : "disable"} the distribution`, e);
    }
    setBusy(false);
    list.reload(true);
  };

  const remove = async () => {
    try {
      for (const id of ids) {
        const current = await cloudfront.send(new GetDistributionConfigCommand({ Id: id }));
        await cloudfront.send(new DeleteDistributionCommand({ Id: id, IfMatch: current.ETag }));
      }
      notify.success(`Successfully deleted ${ids.join(", ")}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the distribution", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell
      service="cloudfront"
      contentType="table"
      breadcrumbs={[{ text: "CloudFront", href: "/cloudfront/distributions" }, { text: "Distributions", href: "/cloudfront/distributions" }]}
    >
      <ResourceTable
        title="Distributions"
        resourceName="distributions"
        global
        filterPlaceholder="Search all distributions"
        emptyDescription="A distribution tells CloudFront where your content comes from and how to deliver it."
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(d) => d.Id ?? ""}
        selectionType="multi"
        selected={live}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => navigate("/cloudfront/distributions/create")}>Create distribution</Button>}
        actions={
          <>
            <Button disabled={live.length === 0 || live.some((d) => d.Enabled)} loading={busy} onClick={() => toggle(true)}>
              Enable
            </Button>
            <Button disabled={live.length === 0 || live.some((d) => !d.Enabled)} loading={busy} onClick={() => toggle(false)}>
              Disable
            </Button>
            <Button disabled={live.length === 0 || live.some((d) => d.Enabled)} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => navigate("/cloudfront/distributions/create")}>
              Create distribution
            </Button>
          </>
        }
        columns={[
          {
            id: "id",
            header: "ID",
            cell: (d) => <RouterLink to={`/cloudfront/distributions/${d.Id}`}>{d.Id}</RouterLink>,
            sortingField: "Id",
            isRowHeader: true,
          },
          { id: "description", header: "Description", cell: (d) => d.Comment || "-" },
          { id: "domain", header: "Domain name", cell: (d) => d.DomainName ?? "-" },
          { id: "aliases", header: "Alternate domain names", cell: (d) => d.Aliases?.Items?.join(", ") || "-" },
          { id: "origins", header: "Origins", cell: (d) => d.Origins?.Items?.map((o) => o.DomainName).join(", ") || "-" },
          { id: "status", header: "Status", cell: (d) => <EnabledStatus enabled={d.Enabled} /> },
          { id: "modified", header: "Last modified", cell: (d) => (d.Status === "InProgress" ? "Deploying" : formatDate(d.LastModifiedTime)) },
        ]}
      />
      <ConfirmDelete
        visible={deleting}
        title={`Delete distribution${ids.length === 1 ? "" : "s"}`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting a distribution cannot be undone."
      >
        <Box>{ids.join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
