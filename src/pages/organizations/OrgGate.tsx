import { useState, type ReactNode } from "react";
import { CreateOrganizationCommand, type Organization, type Root } from "@aws-sdk/client-organizations";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import { organizations } from "../../clients/organizations";
import { switchAccount } from "../../components/AccountMenu";
import { CLI_PROFILE, accountId } from "../../config";
import { useNotify } from "../../lib/notify";
import type { OrgState } from "./orgutil";

/** Shown when the account in use is in no organization. */
function NoOrganization({ onCreated }: { onCreated: () => void }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await organizations.send(new CreateOrganizationCommand({ FeatureSet: "ALL" }));
      notify.success("Organization created. This account is its management account.");
      onCreated();
    } catch (e) {
      notify.error("Could not create the organization", e);
    }
    setBusy(false);
  };
  return (
    <Container>
      <Box textAlign="center" margin={{ vertical: "l" }}>
        <SpaceBetween size="m">
          <div>
            <b>No organization</b>
            <Box variant="p">Account {accountId()} is not in an organization.</Box>
            <Box variant="p" color="text-body-secondary">
              An organization groups accounts so you can manage them together and apply service control policies. The account you are in becomes its
              management account.
            </Box>
          </div>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            Create an organization
          </Button>
          <Box color="text-body-secondary" fontSize="body-s">
            Or use the CLI: <Box variant="code">aws --profile {CLI_PROFILE} organizations create-organization</Box>
          </Box>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/** Shown when the account in use is a member. Only the management account can see and change the organization. */
function MemberNotice({ org }: { org: Organization }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const master = org.MasterAccountId ?? "";
  const go = async () => {
    setBusy(true);
    const reason = await switchAccount(master);
    setBusy(false);
    if (reason) notify.error("Cannot switch account", reason);
  };
  return (
    <Alert
      type="info"
      header="This account is a member of an organization"
      action={
        <Button loading={busy} onClick={() => void go()}>
          Switch to the management account
        </Button>
      }
    >
      Account {accountId()} belongs to organization {org.Id}. Only its management account, {master}, can see and manage the organization.
    </Alert>
  );
}

/** The organization ID under the side navigation, as in the AWS console. Members see it too. */
export function OrgIdInNav({ state }: { state: { data?: OrgState } }) {
  const s = state.data;
  if (!s || s.kind === "none" || !s.org.Id) return null;
  return (
    <Box padding={{ horizontal: "xl", vertical: "m" }}>
      <div style={{ borderTop: "1px solid var(--color-border-divider-default-cx07f2, #c6c6cd)", paddingTop: 16 }}>
        <Box variant="awsui-key-label">Organization ID</Box>
        <CopyToClipboard variant="inline" textToCopy={s.org.Id} copyButtonAriaLabel="Copy organization ID" copySuccessText="Copied" copyErrorText="Failed to copy" />
      </div>
    </Box>
  );
}

/**
 * Runs a page only for the management account. Without an organization it offers to create one.
 * In a member account it explains who manages the organization and offers to switch there.
 */
export function OrgGate({
  state,
  children,
}: {
  state: { data?: OrgState; error?: string; reload: (silent?: boolean) => unknown };
  children: (org: Organization, root: Root) => ReactNode;
}) {
  const s = state.data;
  if (state.error)
    return (
      <Alert type="error" header="Could not load the organization">
        {state.error}
      </Alert>
    );
  if (!s)
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
      </Box>
    );
  if (s.kind === "none") return <NoOrganization onCreated={() => state.reload()} />;
  if (s.kind === "member") return <MemberNotice org={s.org} />;
  return <>{children(s.org, s.root)}</>;
}
