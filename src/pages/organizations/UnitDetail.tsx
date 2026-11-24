import { useSearchParams } from "react-router-dom";
import { DescribeOrganizationalUnitCommand, type Organization, type Root, paginateListAccountsForParent, paginateListOrganizationalUnitsForParent } from "@aws-sdk/client-organizations";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Tabs from "@cloudscape-design/components/tabs";
import { organizations } from "../../clients/organizations";
import { Copy, Pair } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { accountName } from "../../lib/accounts";
import { useLoad } from "../../lib/useLoad";
import { OrgGate, OrgIdInNav } from "./OrgGate";
import { type OrgNode, byKindThenName, loadOrgState, parentOf, scpsEnabled, targetHref, unitHref } from "./orgutil";
import { TargetPolicies, TargetTags } from "./TargetParts";

/** The root or one organizational unit, with what it holds. */
function UnitView({ id, org, root }: { id: string; org: Organization; root: Root }) {
  const isRoot = id === root.Id;
  const data = useLoad(async () => {
    const [ou, parent] = isRoot ? [undefined, undefined] : await Promise.all([organizations.send(new DescribeOrganizationalUnitCommand({ OrganizationalUnitId: id })).then((r) => r.OrganizationalUnit), parentOf(id)]);
    const children: OrgNode[] = [];
    for await (const page of paginateListOrganizationalUnitsForParent({ client: organizations }, { ParentId: id })) {
      for (const u of page.OrganizationalUnits ?? []) children.push({ id: u.Id ?? "", parentId: id, kind: "ou", name: u.Name ?? u.Id ?? "" });
    }
    for await (const page of paginateListAccountsForParent({ client: organizations }, { ParentId: id })) {
      for (const a of page.Accounts ?? []) children.push({ id: a.Id ?? "", parentId: id, kind: "account", name: accountName(a.Name, a.Id === org.MasterAccountId) ?? a.Id ?? "", account: a });
    }
    return { name: isRoot ? "Root" : ou?.Name ?? id, arn: isRoot ? root.Arn : ou?.Arn, parent, children: children.sort(byKindThenName) };
  }, [id, isRoot]);
  const d = data.data;

  if (data.error)
    return (
      <Alert type="error" header="Could not load the organizational unit">
        {data.error}
      </Alert>
    );
  if (!d)
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
      </Box>
    );

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={isRoot ? "The top of the organization. Policies attached here apply to every account." : "An organizational unit."}
        actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => data.reload()} />}
      >
        {d.name}
      </Header>
      <Container header={<Header variant="h2">Details</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <Pair label="ID">
            <Copy text={id} />
          </Pair>
          {isRoot ? (
            <Pair label="Service control policies">
              <StatusIndicator type={scpsEnabled(root) ? "success" : "stopped"}>{scpsEnabled(root) ? "On" : "Off"}</StatusIndicator>
            </Pair>
          ) : (
            <Pair label="Parent">{d.parent ? <RouterLink to={unitHref(d.parent.id)}>{d.parent.name}</RouterLink> : "-"}</Pair>
          )}
          <Pair label="ARN">
            <Copy text={d.arn} />
          </Pair>
        </ColumnLayout>
      </Container>
      <Tabs
        tabs={[
          {
            id: "children",
            label: "Accounts and OUs",
            content: (
              <ResourceTable
                title="Accounts and organizational units"
                description="What this holds directly."
                variant="container"
                stickyHeader={false}
                global
                resourceName="accounts or organizational units here"
                items={d.children}
                loading={data.loading}
                onRefresh={() => data.reload()}
                trackBy={(n) => n.id}
                emptyDescription={
                  <>
                    Add accounts and organizational units on the <RouterLink to="/organizations/accounts">AWS accounts</RouterLink> page.
                  </>
                }
                columns={[
                  { id: "name", header: "Name", cell: (n) => <RouterLink to={targetHref(n.id)}>{n.name}</RouterLink>, sortingField: "name", isRowHeader: true },
                  { id: "id", header: "ID", cell: (n) => n.id },
                  { id: "type", header: "Type", cell: (n) => (n.kind === "account" ? "Account" : "Organizational unit") },
                  { id: "email", header: "Email", cell: (n) => n.account?.Email ?? "-" },
                ]}
              />
            ),
          },
          { id: "policies", label: "Policies", content: <TargetPolicies targetId={id} enabled={scpsEnabled(root)} /> },
          { id: "tags", label: "Tags", content: <TargetTags resourceId={id} /> },
        ]}
      />
    </SpaceBetween>
  );
}

export default function UnitDetail() {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const state = useLoad(loadOrgState, []);
  return (
    <Shell
      service="organizations"
      navExtra={<OrgIdInNav state={state} />}
      breadcrumbs={[
        { text: "AWS Organizations", href: "/organizations/accounts" },
        { text: "AWS accounts", href: "/organizations/accounts" },
        { text: id, href: unitHref(id) },
      ]}
    >
      <OrgGate state={state}>{(org, root) => <UnitView id={id} org={org} root={root} />}</OrgGate>
    </Shell>
  );
}
