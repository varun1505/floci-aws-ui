import { useEffect, useState } from "react";
import { GetSchemaCreationStatusCommand, StartSchemaCreationCommand } from "@aws-sdk/client-appsync";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import { appsync } from "../../clients/appsync";
import { Code } from "../../components/Code";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { SCHEMA_TEMPLATE, parseTypes, readSchema, schemaErrors } from "./appsyncutil";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The first save starts a helper container in floci, so it can take a few minutes.
const MAX_WAIT_MS = 5 * 60 * 1000;

/** The schema of an API: edit the SDL, save it, and see its types and fields. */
export function SchemaTab({ apiId }: { apiId: string }) {
  const notify = useNotify();
  const saved = useLoad(() => readSchema(apiId), [apiId]);
  const [text, setText] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Fill the editor once, when the saved schema arrives.
  useEffect(() => {
    if (saved.data !== undefined && text === undefined) setText(saved.data || SCHEMA_TEMPLATE);
  }, [saved.data, text]);

  const save = async () => {
    if (!text?.trim()) return setErrors(["Enter a schema."]);
    setBusy(true);
    setErrors([]);
    try {
      let res: { status?: string; details?: string } = await appsync.send(new StartSchemaCreationCommand({ apiId, definition: new TextEncoder().encode(text) }));
      const start = Date.now();
      while (res.status === "PROCESSING" && Date.now() - start < MAX_WAIT_MS) {
        await wait(1000);
        res = await appsync.send(new GetSchemaCreationStatusCommand({ apiId }));
      }
      if (res.status === "SUCCESS" || res.status === "ACTIVE") {
        notify.success("The schema was saved.");
        saved.reload(true);
      } else if (res.status === "PROCESSING") {
        setErrors(["floci is still working on the schema. Refresh this tab in a minute."]);
      } else {
        setErrors(schemaErrors(res.details));
      }
    } catch (e) {
      setErrors([errorMessage(e)]);
    }
    setBusy(false);
  };

  const fields = parseTypes(saved.data ?? "");

  if (saved.error) return <Alert type="error" header="Could not load the schema">{saved.error}</Alert>;
  if (text === undefined)
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
      </Box>
    );

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            description={saved.data ? "The GraphQL schema of this API, in SDL." : "This API has no schema yet. Edit the example and save it."}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={busy || text === (saved.data || SCHEMA_TEMPLATE)} onClick={() => (setText(saved.data || SCHEMA_TEMPLATE), setErrors([]))}>
                  Discard changes
                </Button>
                <Button variant="primary" loading={busy} onClick={save}>
                  Save schema
                </Button>
              </SpaceBetween>
            }
          >
            Schema
          </Header>
        }
      >
        <SpaceBetween size="m">
          {busy && <Alert type="info">Saving the schema. The first save can take a few minutes, because floci starts its GraphQL container.</Alert>}
          {errors.length > 0 && (
            <Alert type="error" header="The schema was not saved">
              {errors.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </Alert>
          )}
          <Code value={text} onChange={setText} language="text" height={380} ariaLabel="Schema" />
        </SpaceBetween>
      </Container>

      <Table
        header={
          <Header variant="h2" counter={`(${fields.length})`} description="Read from the saved schema.">
            Types and fields
          </Header>
        }
        items={fields}
        trackBy={(f) => `${f.type}.${f.field}`}
        columnDefinitions={[
          { id: "type", header: "Type", cell: (f) => f.type, isRowHeader: true },
          { id: "field", header: "Field", cell: (f) => f.field },
          { id: "returns", header: "Field type", cell: (f) => f.returns },
        ]}
        empty={<Box textAlign="center">No types. Save a schema first.</Box>}
      />
    </SpaceBetween>
  );
}
