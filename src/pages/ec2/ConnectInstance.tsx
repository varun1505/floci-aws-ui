import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { flociHost } from "../../config";
import { Shell } from "../../components/Shell";
import { useLoad } from "../../lib/useLoad";
import { sshCommand, terminalInfo } from "./connect";
import { InstanceState, Pair, listInstances, tagName } from "./ec2util";

const copy = (text: string) => <CopyToClipboard variant="inline" textToCopy={text} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />;

// How to turn the terminal on, for the compose file in this repository.
const ENABLE = `console:
  image: ghcr.io/varun1505/floci-aws-ui:latest
  environment:
    FLOCI_ENDPOINT: http://floci:4566
    EC2_TERMINAL: "1"
  # The Docker daemon that floci uses. This is root on the Docker host.
  user: root
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock`;

/** The "Connect to instance" page: a browser terminal, or the command for an SSH client. */
export default function ConnectInstance() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("terminal");
  const instance = useLoad(async () => {
    const found = (await listInstances([id]))[0];
    if (!found) throw new Error(`The instance ID '${id}' does not exist.`);
    return found;
  }, [id]);
  const info = useLoad(() => terminalInfo(id), [id]);
  const host = useLoad(flociHost, []);
  const i = instance.data;
  const state = i?.State?.Name ?? "";
  const running = state === "running";
  const name = tagName(i?.Tags);
  const terminal = info.data;
  const canConnect = tab === "terminal" && running && Boolean(terminal?.enabled) && terminal?.state === "running";

  const open = () => window.open(`/ec2/instances/${id}/terminal`, "_blank", "noopener");

  return (
    <Shell
      service="ec2"
      breadcrumbs={[
        { text: "EC2", href: "/ec2/home" },
        { text: "Instances", href: "/ec2/instances" },
        { text: id, href: `/ec2/instances/${id}` },
        { text: "Connect to instance", href: `/ec2/instances/${id}/connect` },
      ]}
    >
      <ContentLayout
        header={
          <Header variant="h1" description={`Connect to your instance ${id}${name ? ` (${name})` : ""} using any of these options`}>
            Connect to instance
          </Header>
        }
      >
        {instance.error ? (
          <Alert type="error" header="Could not load the instance">
            {instance.error}
          </Alert>
        ) : !i || info.loading ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container>
              <Tabs
                activeTabId={tab}
                onChange={(e) => setTab(e.detail.activeTabId)}
                tabs={[
                  {
                    id: "terminal",
                    label: "Browser terminal",
                    content: (
                      <SpaceBetween size="l">
                        <Box>
                          Opens a shell on the instance in a new browser tab. In this environment the instance is a container on the floci host, so the console opens the
                          shell in it through Docker, the way Session Manager would. No key pair and no open port are needed.
                        </Box>
                        {!running && (
                          <Alert type="warning" header="The instance is not running">
                            Start the instance to connect to it.
                          </Alert>
                        )}
                        {terminal && !terminal.enabled ? (
                          <Alert type="info" header="The browser terminal is off">
                            <SpaceBetween size="s">
                              <Box>{terminal.reason}</Box>
                              <Box>
                                Start the console with <code>EC2_TERMINAL=1</code> (or <code>floci-aws-ui serve --terminal</code>) and give it the Docker daemon that floci
                                uses. With Docker Compose:
                              </Box>
                              <Box variant="code">
                                <pre style={{ margin: 0 }}>{ENABLE}</pre>
                              </Box>
                              <Box>Anyone who can open this console can then run commands in your instances, and through Docker, on the host.</Box>
                            </SpaceBetween>
                          </Alert>
                        ) : (
                          terminal &&
                          running &&
                          terminal.state !== "running" && (
                            <Alert type="warning" header="The instance has no running container">
                              {terminal.reason ?? `Its container is ${terminal.state}.`}
                            </Alert>
                          )
                        )}
                        <ColumnLayout columns={3} variant="text-grid">
                          <Pair label="Instance ID">{id}</Pair>
                          <Pair label="Instance state">
                            <InstanceState state={state} />
                          </Pair>
                          <Pair label="User name">root</Pair>
                        </ColumnLayout>
                      </SpaceBetween>
                    ),
                  },
                  {
                    id: "ssh",
                    label: "SSH client",
                    content: (
                      <SpaceBetween size="l">
                        {!i.KeyName && (
                          <Alert type="warning" header="This instance has no key pair">
                            floci starts an SSH server and installs a key only when the instance is launched with a key pair. Use the browser terminal, or launch a new
                            instance with a key pair.
                          </Alert>
                        )}
                        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                          <li>Open an SSH client.</li>
                          <li>
                            Locate your private key file. The key used to launch this instance is <strong>{i.KeyName ? `${i.KeyName}.pem` : "not set"}</strong>.
                          </li>
                          <li>
                            Run this command, if necessary, to ensure your key is not publicly viewable.
                            <Box variant="code">{copy(`chmod 400 "${i.KeyName ?? "<your-key>"}.pem"`)}</Box>
                          </li>
                          <li>
                            Connect to the floci host on the port that floci published for this instance:{" "}
                            <strong>
                              {host.data || "<floci-host>"}:{terminal?.sshPort ?? "<ssh-port>"}
                            </strong>
                          </li>
                        </ol>
                        <SpaceBetween size="xs">
                          <Box variant="awsui-key-label">Example</Box>
                          <Box variant="code">{copy(sshCommand(i.KeyName, host.data, terminal?.sshPort))}</Box>
                        </SpaceBetween>
                        {!terminal?.sshPort && (
                          <Box color="text-body-secondary">
                            The console can show the port only when the browser terminal is on. floci publishes SSH ports from 2200 up. On the floci host,{" "}
                            <code>docker port floci-aws-ec2-{id} 22</code> prints it.
                          </Box>
                        )}
                        <Box color="text-body-secondary">Unlike EC2, the user is root, and the public IP address of the instance does not route outside the floci host.</Box>
                      </SpaceBetween>
                    ),
                  },
                ]}
              />
            </Container>
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => navigate(`/ec2/instances/${id}`)}>
                  Cancel
                </Button>
                {tab === "terminal" && (
                  <Button variant="primary" disabled={!canConnect} onClick={open}>
                    Connect
                  </Button>
                )}
              </SpaceBetween>
            </Box>
          </SpaceBetween>
        )}
      </ContentLayout>
    </Shell>
  );
}
