import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateFunctionCommand, type Architecture, type Runtime } from "@aws-sdk/client-lambda";
import { strToU8, zipSync } from "fflate";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FileUpload from "@cloudscape-design/components/file-upload";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import { lambda } from "../../clients/lambda";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { DEFAULT_ROLE, RUNTIMES } from "./runtimes";

export default function CreateFunction() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [source, setSource] = useState("scratch");
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState(RUNTIMES[1]);
  const [arch, setArch] = useState("x86_64");
  const [handler, setHandler] = useState("");
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const scratch = source === "scratch";
  const nameError = !name
    ? "Function name is required."
    : !/^[a-zA-Z0-9-_]{1,64}$/.test(name)
      ? "Use only letters, numbers, hyphens, or underscores with no spaces."
      : "";
  const starterError = scratch && !runtime.starter ? `Inline authoring is not available for ${runtime.label}. Choose "Upload a .zip file".` : "";
  const zipError = !scratch && files.length === 0 ? "Choose a .zip file." : "";
  const handlerError = !scratch && !handler ? "Handler is required." : "";

  const create = async () => {
    setTouched(true);
    if (nameError || starterError || zipError || handlerError) return;
    setBusy(true);
    setError("");
    try {
      const starter = runtime.starter;
      const ZipFile = scratch
        ? zipSync({ [starter!.file]: strToU8(starter!.code) })
        : new Uint8Array(await files[0].arrayBuffer());
      await lambda.send(
        new CreateFunctionCommand({
          FunctionName: name,
          Runtime: runtime.value as Runtime,
          Handler: scratch ? starter!.handler : handler,
          Role: role || DEFAULT_ROLE,
          Architectures: [arch as Architecture],
          Code: { ZipFile },
        }),
      );
      notify.success(`Successfully created the function ${name}.`);
      navigate(`/lambda/functions/${name}`);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Shell
      service="lambda"
      contentType="form"
      breadcrumbs={[
        { text: "Lambda", href: "/lambda/home" },
        { text: "Functions", href: "/lambda/functions" },
        { text: "Create function", href: "/lambda/functions/create" },
      ]}
    >
      <ContentLayout header={<Header variant="h1">Create function</Header>}>
        <Form
          errorText={error}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => navigate("/lambda/functions")}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create function
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Tiles
              value={source}
              onChange={(e) => setSource(e.detail.value)}
              columns={2}
              items={[
                { value: "scratch", label: "Author from scratch", description: "Start with a simple Hello World example." },
                { value: "zip", label: "Upload a .zip file", description: "Deploy a .zip package you built yourself." },
              ]}
            />
            <Container header={<Header variant="h2">Basic information</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Function name"
                  description="Enter a name that describes the purpose of your function."
                  constraintText="Function name must be 1 to 64 characters, must be unique to the Region, and can't include spaces. Valid characters are a-z, A-Z, 0-9, hyphens (-), and underscores (_)."
                  errorText={touched ? nameError : ""}
                >
                  <Input value={name} placeholder="myFunctionName" onChange={(e) => setName(e.detail.value)} />
                </FormField>
                <FormField
                  label="Runtime"
                  description="Choose the language to use to write your function."
                  errorText={touched ? starterError : ""}
                >
                  <Select
                    selectedOption={runtime}
                    options={RUNTIMES}
                    onChange={(e) => setRuntime(RUNTIMES.find((r) => r.value === e.detail.selectedOption.value)!)}
                  />
                </FormField>
                <FormField label="Architecture" description="Choose the instruction set architecture you want for your function code.">
                  <RadioGroup
                    value={arch}
                    onChange={(e) => setArch(e.detail.value)}
                    items={[
                      { value: "x86_64", label: "x86_64" },
                      { value: "arm64", label: "arm64" },
                    ]}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            {!scratch && (
              <Container header={<Header variant="h2">Code source</Header>}>
                <SpaceBetween size="l">
                  <FormField label="Upload a .zip file" errorText={touched ? zipError : ""}>
                    <FileUpload
                      value={files}
                      onChange={(e) => setFiles(e.detail.value)}
                      accept=".zip,.jar"
                      showFileSize
                      i18nStrings={{
                        uploadButtonText: () => "Upload",
                        dropzoneText: () => "Drop file to upload",
                        removeFileAriaLabel: (i) => `Remove file ${i + 1}`,
                        limitShowFewer: "Show fewer files",
                        limitShowMore: "Show more files",
                        errorIconAriaLabel: "Error",
                      }}
                    />
                  </FormField>
                  <FormField
                    label="Handler"
                    description="The method in your code that processes events, as file.method."
                    errorText={touched ? handlerError : ""}
                  >
                    <Input value={handler} placeholder="index.handler" onChange={(e) => setHandler(e.detail.value)} />
                  </FormField>
                </SpaceBetween>
              </Container>
            )}
            <Container header={<Header variant="h2">Permissions</Header>}>
              <FormField
                label="Execution role"
                description="The emulator does not enforce IAM. Any role ARN works."
              >
                <Input value={role} onChange={(e) => setRole(e.detail.value)} />
              </FormField>
            </Container>
          </SpaceBetween>
        </Form>
      </ContentLayout>
    </Shell>
  );
}
