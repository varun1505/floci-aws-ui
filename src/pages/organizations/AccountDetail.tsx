import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DescribeAccountCommand, type Organization, type Root } from "@aws-sdk/client-organizations";
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
import { switchAccount } from "../../components/AccountMenu";
import { Copy, Pair } from "../../components/Pair";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { accountId } from "../../config";
import { accountName } from "../../lib/accounts";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { OrgGate } from "./OrgGate";
import { JOINED, accountHref, loadOrgState, parentOf, scpsEnabled, unitHref } from "./orgutil";
import { TargetPolicies, TargetTags } from "./TargetParts";

function AccountView({ id, org, root }: { id: string; org: Organization; root: Root }) {
  const notify = useNotify();
  const [switching, setSwitching] = useState(false);
  const data = useLoad(async () => {
    const [account, parent] = await Promise.all([organizations.send(new DescribeAccountCommand({ AccountId: id })).then((r) => r.Account), parentOf(id)]);
    return { account, parent };
  }, [id]);
  const a = data.data?.account;
  const isMaster = id === org.MasterAccountId;
  const name = accountName(a?.Name, isMaster) ?? id;

  const go = async () => {
    setSwitching(true);
    const reason = await switchAccount(id);
    setSwitching(false);
    if (reason) notify.error("Cannot switch account", reason);
  };

  if (data.error)
    return (
      <Alert type="error" header="Could not load the account">
        {data.error}
      </Alert>
    );
  if (!a)
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
      </Box>
    );

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={isMaster ? "The management account of the organization." : undefined}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="refresh" ariaLabel="Refresh" onClick={() => data.reload()} />
            <Button variant="primary" loading={switching} disabled={id === accountId()} onClick={() => void go()}>
              {id === accountId() ? "You are in this account" : "Switch to this account"}
            </Button>
          </SpaceBetween>
        }
      >
        {name}
      </Header>
      <Container header={<Header variant="h2">Account details</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <Pair label="Account ID">
            <Copy text={a.Id} />
          </Pair>
          <Pair label="Email">{a.Email}</Pair>
          <Pair label="Status">
            <StatusIndicator type={a.Status === "ACTIVE" ? "success" : "stopped"}>{a.Status === "ACTIVE" ? "Active" : a.Status}</StatusIndicator>
          </Pair>
          <Pair label="Joined">{`${JOINED[a.JoinedMethod ?? ""] ?? a.JoinedMethod ?? ""} ${formatDate(a.JoinedTimestamp)}`}</Pair>
          <Pair label="Parent">{data.data?.parent ? <RouterLink to={unitHref(data.data.parent.id)}>{data.data.parent.name}</RouterLink> : "-"}</Pair>
          <Pair label="ARN">
            <Copy text={a.Arn} />
          </Pair>
        </ColumnLayout>
      </Container>
      <Tabs
        tabs={[
          { id: "policies", label: "Policies", content: <TargetPolicies targetId={id} enabled={scpsEnabled(root)} /> },
          { id: "tags", label: "Tags", content: <TargetTags resourceId={id} /> },
        ]}
      />
    </SpaceBetween>
  );
}

export default function AccountDetail() {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const state = useLoad(loadOrgState, []);
  return (
    <Shell
      service="organizations"
      breadcrumbs={[
        { text: "AWS Organizations", href: "/organizations/accounts" },
        { text: "AWS accounts", href: "/organizations/accounts" },
        { text: id, href: accountHref(id) },
      ]}
    >
      <OrgGate state={state}>{(org, root) => <AccountView id={id} org={org} root={root} />}</OrgGate>
    </Shell>
  );
}
