import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  type Capability,
  CreateStackCommand,
  DescribeStacksCommand,
  GetTemplateCommand,
  GetTemplateSummaryCommand,
  type Parameter,
  UpdateStackCommand,
  ValidateTemplateCommand,
} from "@aws-sdk/client-cloudformation";
import Alert from "@cloudscape-design/components/alert";
import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { cloudformation } from "../../clients/cloudformation";
import { Code } from "../../components/Code";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { CAPABILITIES, CFN_CRUMBS, isJson, stackNameError } from "./cfnutil";
import { SAMPLES } from "./samples";

type Format = "yaml" | "json";
type TagRow = { key: string; value: string };

/** The create stack form. Opened with ?update=<stack name> it loads that stack and updates it. */
export default function CreateStack() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [search] = useSearchParams();
  const updating = search.get("update") ?? "";
  const form = useSubmit();
  const [name, setName] = useState(updating);
  const [format, setFormat] = useState<Format>("yaml");
  const [template, setTemplate] = useState(updating ? "" : SAMPLES[0].yaml);
  const [sample, setSample] = useState(updating ? "" : SAMPLES[0].id);
  // Only the values the user typed. The other parameters keep their current or default value.
  const [values, setValues] = useState<Record<string, string>>({});
  const [previous, setPrevious] = useState<Record<string, string>>({});
  const [caps, setCaps] = useState<string[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | undefined>(undefined);

  // Update mode: start from the template, parameter values, capabilities and tags of the stack.
  const current = useLoad(async () => {
    if (!updating) return undefined;
    const [described, body] = await Promise.all([
      cloudformation.send(new DescribeStacksCommand({ StackName: updating })),
      cloudformation.send(new GetTemplateCommand({ StackName: updating, TemplateStage: "Original" })),
    ]);
    const stack = described.Stacks?.[0];
    const text = body.TemplateBody ?? "";
    setTemplate(text);
    setFormat(isJson(text) ? "json" : "yaml");
    setPrevious(Object.fromEntries((stack?.Parameters ?? []).map((p) => [p.ParameterKey ?? "", p.ParameterValue ?? ""])));
    setCaps(stack?.Capabilities ?? []);
    setTags((stack?.Tags ?? []).map((t) => ({ key: t.Key ?? "", value: t.Value ?? "" })));
    return stack;
  }, [updating]);

  // The template says which parameters it takes and which capabilities it needs.
  const summary = useLoad(async () => {
    if (!template.trim()) return undefined;
    return cloudformation.send(new GetTemplateSummaryCommand({ TemplateBody: template }));
  }, [template]);

  useEffect(() => setChecked(undefined), [template]);

  const parameters = summary.data?.Parameters ?? [];
  const valueOf = (key: string, fallback?: string) => values[key] ?? previous[key] ?? fallback ?? "";
  const back = updating ? `/cloudformation/stack?name=${encodeURIComponent(updating)}` : "/cloudformation/stacks";

  const pickSample = (id: string, as: Format) => {
    const found = SAMPLES.find((s) => s.id === id);
    if (!found) return;
    setSample(id);
    setTemplate(found[as]);
    setValues({});
  };

  const switchFormat = (next: Format) => {
    setFormat(next);
    // An untouched sample follows the switch. A template the user edited stays as it is.
    const found = SAMPLES.find((s) => s.id === sample);
    if (found && template === found[format]) setTemplate(found[next]);
  };

  const validate = async () => {
    setChecking(true);
    try {
      const res = await cloudformation.send(new ValidateTemplateCommand({ TemplateBody: template }));
      setChecked({ ok: true, text: res.Description ? `The template is valid. ${res.Description}` : "The template is valid." });
    } catch (e) {
      setChecked({ ok: false, text: errorMessage(e) });
    }
    setChecking(false);
  };

  const submit = async () => {
    const nameProblem = updating ? "" : stackNameError(name);
    if (nameProblem) return form.setError(nameProblem);
    if (!template.trim()) return form.setError("Enter a template.");
    if (summary.error) return form.setError(`The template is not valid. ${summary.error}`);
    const missing = parameters.filter((p) => p.DefaultValue === undefined && values[p.ParameterKey ?? ""] === undefined && previous[p.ParameterKey ?? ""] === undefined);
    if (missing.length) return form.setError(`Enter a value for ${missing.map((p) => p.ParameterKey).join(", ")}.`);
    // CAPABILITY_NAMED_IAM also covers what CAPABILITY_IAM allows.
    const has = (c: string) => caps.includes(c) || (c === "CAPABILITY_IAM" && caps.includes("CAPABILITY_NAMED_IAM"));
    const needed = (summary.data?.Capabilities ?? []).filter((c) => !has(c));
    if (needed.length) return form.setError(`This template needs ${needed.join(", ")}. Select it under Capabilities.`);
    if (tags.some((t) => !t.key.trim())) return form.setError("Every tag needs a key.");

    const Parameters: Parameter[] = parameters.map((p) => {
      const key = p.ParameterKey ?? "";
      if (updating && values[key] === undefined && previous[key] !== undefined) return { ParameterKey: key, UsePreviousValue: true };
      return { ParameterKey: key, ParameterValue: valueOf(key, p.DefaultValue) };
    });
    const input = {
      StackName: name,
      TemplateBody: template,
      Parameters,
      Capabilities: caps as Capability[],
      Tags: tags.map((t) => ({ Key: t.key.trim(), Value: t.value })),
    };
    await form.run(async () => {
      if (updating) await cloudformation.send(new UpdateStackCommand(input));
      else await cloudformation.send(new CreateStackCommand(input));
      notify.success(updating ? `Update initiated for ${name}.` : `Create initiated for ${name}.`);
      navigate(`/cloudformation/stack?name=${encodeURIComponent(name)}`);
    });
  };

  return (
    <Shell
      service="cloudformation"
      contentType="form"
      breadcrumbs={[...CFN_CRUMBS, updating ? { text: `Update ${updating}`, href: `/cloudformation/stacks/create?update=${encodeURIComponent(updating)}` } : { text: "Create stack", href: "/cloudformation/stacks/create" }]}
    >
      <ContentLayout header={<Header variant="h1">{updating ? "Update stack" : "Create stack"}</Header>}>
        <Form
          errorText={form.error || current.error}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => navigate(back)}>
                Cancel
              </Button>
              <Button variant="primary" loading={form.busy} disabled={!!current.error || (!!updating && current.loading)} onClick={submit}>
                {updating ? "Update stack" : "Create stack"}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Stack name</Header>}>
              <FormField label="Stack name" constraintText={updating ? "You can't change the name of a stack." : "Letters, numbers and hyphens. Starts with a letter. Up to 128 characters."}>
                <Input value={name} disabled={!!updating} placeholder="my-stack" onChange={(e) => setName(e.detail.value)} />
              </FormField>
            </Container>

            <Container
              header={
                <Header
                  variant="h2"
                  description="A template is a JSON or YAML file that describes the resources of the stack."
                  actions={
                    <Button loading={checking} disabled={!template.trim()} onClick={validate}>
                      Validate template
                    </Button>
                  }
                >
                  Template
                </Header>
              }
            >
              <SpaceBetween size="m">
                <SpaceBetween direction="horizontal" size="l">
                  <FormField label="Template format">
                    <SegmentedControl
                      label="Template format"
                      selectedId={format}
                      onChange={(e) => switchFormat(e.detail.selectedId as Format)}
                      options={[
                        { id: "yaml", text: "YAML" },
                        { id: "json", text: "JSON" },
                      ]}
                    />
                  </FormField>
                  <FormField label="Sample template">
                    <div style={{ minWidth: 300 }}>
                      <Select
                        selectedOption={SAMPLES.filter((s) => s.id === sample).map((s) => ({ value: s.id, label: s.label }))[0] ?? null}
                        options={SAMPLES.map((s) => ({ value: s.id, label: s.label, description: s.description }))}
                        onChange={(e) => pickSample(e.detail.selectedOption.value ?? "", format)}
                        placeholder="Start from a sample"
                      />
                    </div>
                  </FormField>
                </SpaceBetween>
                <Code value={template} onChange={setTemplate} language={format} height={380} ariaLabel="Template" />
                {checked && <Alert type={checked.ok ? "success" : "error"}>{checked.text}</Alert>}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2" description="Parameters are defined in your template. They let you give custom values when you create or update a stack.">Parameters</Header>}>
              {summary.error ? (
                <StatusIndicator type="warning">The parameters show when the template is valid. {summary.error}</StatusIndicator>
              ) : summary.loading && !summary.data ? (
                <StatusIndicator type="loading">Reading the template</StatusIndicator>
              ) : parameters.length === 0 ? (
                <Box color="text-body-secondary">No parameters. There are no parameters defined in your template.</Box>
              ) : (
                <SpaceBetween size="l">
                  {parameters.map((p) => {
                    const key = p.ParameterKey ?? "";
                    return (
                      <FormField key={key} label={key} description={p.Description} constraintText={[p.ParameterType, p.DefaultValue !== undefined ? `Default: ${p.DefaultValue || "(empty)"}` : "No default"].filter(Boolean).join(". ")}>
                        <Input
                          ariaLabel={key}
                          type={p.NoEcho ? "password" : "text"}
                          value={valueOf(key, p.DefaultValue)}
                          onChange={(e) => setValues((cur) => ({ ...cur, [key]: e.detail.value }))}
                        />
                      </FormField>
                    );
                  })}
                </SpaceBetween>
              )}
            </Container>

            <Container header={<Header variant="h2" description="Some templates need you to confirm what they are allowed to create.">Capabilities</Header>}>
              <SpaceBetween size="s">
                {CAPABILITIES.map((c) => (
                  <Checkbox key={c.value} checked={caps.includes(c.value)} description={c.description} onChange={(e) => setCaps((cur) => (e.detail.checked ? [...cur, c.value] : cur.filter((x) => x !== c.value)))}>
                    {c.label}
                  </Checkbox>
                ))}
                {!!summary.data?.Capabilities?.length && <Alert type="info">This template needs {summary.data.Capabilities.join(", ")}.</Alert>}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2" description="CloudFormation puts these tags on the stack and on the resources that take tags.">Tags - optional</Header>}>
              <AttributeEditor
                items={tags}
                addButtonText="Add new tag"
                removeButtonText="Remove"
                empty="No tags associated with the stack."
                onAddButtonClick={() => setTags((cur) => [...cur, { key: "", value: "" }])}
                onRemoveButtonClick={(e) => setTags((cur) => cur.filter((_, i) => i !== e.detail.itemIndex))}
                definition={[
                  {
                    label: "Key",
                    control: (item, index) => <Input value={item.key} placeholder="Enter key" onChange={(e) => setTags((cur) => cur.map((t, i) => (i === index ? { ...t, key: e.detail.value } : t)))} />,
                  },
                  {
                    label: "Value - optional",
                    control: (item, index) => <Input value={item.value} placeholder="Enter value" onChange={(e) => setTags((cur) => cur.map((t, i) => (i === index ? { ...t, value: e.detail.value } : t)))} />,
                  },
                ]}
              />
            </Container>
          </SpaceBetween>
        </Form>
      </ContentLayout>
    </Shell>
  );
}
