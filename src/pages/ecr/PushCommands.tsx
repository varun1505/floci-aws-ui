import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { Copy } from "../../components/Pair";
import { CLI_PROFILE, flociHost, getRegion } from "../../config";
import { useLoad } from "../../lib/useLoad";

const LOCAL = ["", "localhost", "127.0.0.1", "::1", "[::1]"];

/** The docker commands that push an image to this repository on floci. */
export function pushCommands(name: string, uri: string, region: string) {
  const registry = uri.split("/")[0];
  const image = name.split("/").pop() ?? name;
  return {
    registry,
    steps: [
      {
        text: "Log Docker in to the registry. floci accepts any login, so this step can be left out.",
        command: `aws --profile ${CLI_PROFILE} ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`,
      },
      { text: "Build your Docker image. Skip this step if the image is already built.", command: `docker build -t ${image} .` },
      { text: "Tag the image so that it goes to this repository.", command: `docker tag ${image}:latest ${uri}:latest` },
      { text: "Push the image.", command: `docker push ${uri}:latest` },
    ],
  };
}

export function PushCommands({ name, uri, onDismiss }: { name: string; uri: string; onDismiss: () => void }) {
  const host = useLoad(flociHost, []);
  const { registry, steps } = pushCommands(name, uri, getRegion());
  const port = registry.split(":")[1] ?? "4566";
  const remote = host.data !== undefined && !LOCAL.includes(host.data);

  return (
    <Modal
      visible
      size="large"
      header={`Push commands for ${name}`}
      onDismiss={onDismiss}
      footer={
        <Box float="right">
          <Button variant="primary" onClick={onDismiss}>
            Close
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <Box variant="p">
          The registry address <Box variant="code">{registry}</Box> is a name for localhost. Docker reaches floci through it when floci listens on port {port} of the machine where Docker runs.
        </Box>
        {remote && (
          <Alert type="warning" header={`floci runs on ${host.data}, not on localhost`}>
            Run these commands on the machine where floci runs. Or make port {port} of this machine reach floci first, for example with an SSH tunnel:
            <div>
              <Copy text={`ssh -N -L ${port}:${host.data}:${port} <user>@<a machine that reaches ${host.data}>`} />
            </div>
          </Alert>
        )}
        {steps.map((step, i) => (
          <div key={step.command}>
            <Box variant="p">
              {i + 1}. {step.text}
            </Box>
            <Box variant="code">
              <Copy text={step.command} />
            </Box>
          </div>
        ))}
        <Box color="text-body-secondary" fontSize="body-s">
          A Linux Docker daemon with the containerd image store (the default from Docker Engine 29) takes this address for an HTTPS registry. If the push fails with an HTTPS error, start floci with
          FLOCI_SERVICES_ECR_URI_STYLE=path. The repository URI then starts with localhost:{port}.
        </Box>
      </SpaceBetween>
    </Modal>
  );
}
