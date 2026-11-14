import { useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { Code } from "../../components/Code";
import { FormModal } from "../../components/FormModal";
import { JsonBlock, prettyJson } from "../../components/Pair";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";

/** Shows one JSON policy of a repository, with Edit and Delete. Used for the lifecycle policy and the repository policy. */
export function PolicyTab({
  title,
  description,
  sample,
  load,
  save,
  remove,
}: {
  title: string;
  description: string;
  /** The JSON the editor starts with when there is no policy yet. */
  sample: string;
  /** Gives the policy text, or undefined when the repository has none. */
  load: () => Promise<string | undefined>;
  save: (text: string) => Promise<unknown>;
  remove: () => Promise<unknown>;
}) {
  const notify = useNotify();
  const policy = useLoad(load, [title]);
  const form = useSubmit();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const openEdit = () => {
    setText(prettyJson(policy.data) || sample);
    form.setError("");
    setEditing(true);
  };

  const submit = async () => {
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) return form.setError("The policy must be one JSON object.");
    } catch (e) {
      return form.setError(`The JSON is not valid: ${(e as Error).message}`);
    }
    const ok = await form.run(async () => {
      await save(text);
      notify.success(`${title} saved.`);
      policy.reload(true);
    });
    if (ok) setEditing(false);
  };

  const drop = async () => {
    try {
      await remove();
      notify.success(`${title} deleted.`);
    } catch (e) {
      notify.error(`Could not delete the ${title.toLowerCase()}`, e);
    }
    policy.reload(true);
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={description}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={!policy.data} onClick={drop}>
                Delete
              </Button>
              <Button disabled={policy.loading} onClick={openEdit}>
                {policy.data ? "Edit policy JSON" : "Create policy"}
              </Button>
            </SpaceBetween>
          }
        >
          {title}
        </Header>
      }
    >
      {policy.error ? <Alert type="error">{policy.error}</Alert> : policy.data ? <JsonBlock value={policy.data} /> : <Box color="text-body-secondary">{policy.loading ? "Loading" : "No policy"}</Box>}

      {editing && (
        <FormModal visible size="large" header={`Edit ${title.toLowerCase()}`} submitLabel="Save" busy={form.busy} error={form.error} onDismiss={() => setEditing(false)} onSubmit={submit}>
          <FormField label="Policy JSON" stretch>
            <Code value={text} onChange={setText} language="json" height={360} ariaLabel="Policy JSON" />
          </FormField>
        </FormModal>
      )}
    </Container>
  );
}

/** Runs a "get policy" call and turns "the repository has no policy" into undefined. */
export async function orNone(get: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return await get();
  } catch (e) {
    if (/PolicyNotFoundException$/.test((e as { name?: string }).name ?? "")) return undefined;
    throw e;
  }
}
