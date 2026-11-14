import { useState } from "react";
import { CreateResolverCommand, DeleteResolverCommand, type Resolver, UpdateResolverCommand } from "@aws-sdk/client-appsync";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import { appsync } from "../../clients/appsync";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { JS_TEMPLATE, VTL_REQUEST_TEMPLATE, VTL_RESPONSE_TEMPLATE, listDataSources, listResolvers, parseTypes, readSchema, typeNames } from "./appsyncutil";

const runtimeOf = (r: Resolver) => (r.runtime?.name === "APPSYNC_JS" ? "APPSYNC_JS" : "VTL");
const option = (value: string) => ({ value, label: value });

/** The resolvers of an API: list, attach to a field, edit and delete. */
export function ResolversTab({ apiId }: { apiId: string }) {
  const notify = useNotify();
  const data = useLoad(async () => {
    const fields = parseTypes(await readSchema(apiId));
    const [resolvers, sources] = await Promise.all([listResolvers(apiId, typeNames(fields)), listDataSources(apiId)]);
    return { fields, resolvers, sources };
  }, [apiId]);
  const form = useSubmit();
  const [selected, setSelected] = useState<Resolver[]>([]);
  const [modal, setModal] = useState<"create" | "edit" | "delete" | undefined>(undefined);
  const [typeName, setTypeName] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [source, setSource] = useState("");
  const [runtime, setRuntime] = useState("APPSYNC_JS");
  const [code, setCode] = useState(JS_TEMPLATE);
  const [request, setRequest] = useState(VTL_REQUEST_TEMPLATE);
  const [response, setResponse] = useState(VTL_RESPONSE_TEMPLATE);

  const fields = data.data?.fields ?? [];
  const resolvers = data.data?.resolvers ?? [];
  const sources = data.data?.sources ?? [];
  const editing = modal === "edit";
  const picked = selected[0];
  // A field takes one resolver, so the create form offers only the free fields.
  const freeFields = fields.filter((f) => f.type === typeName && !resolvers.some((r) => r.typeName === f.type && r.fieldName === f.field));

  const openCreate = () => {
    const first = typeNames(fields).find((t) => t === "Query") ?? typeNames(fields)[0] ?? "";
    setTypeName(first);
    setFieldName("");
    setSource(sources[0]?.name ?? "");
    setRuntime("APPSYNC_JS");
    setCode(JS_TEMPLATE);
    setRequest(VTL_REQUEST_TEMPLATE);
    setResponse(VTL_RESPONSE_TEMPLATE);
    form.setError("");
    setModal("create");
  };

  const openEdit = () => {
    setTypeName(picked.typeName ?? "");
    setFieldName(picked.fieldName ?? "");
    setSource(picked.dataSourceName ?? "");
    setRuntime(runtimeOf(picked));
    setCode(picked.code ?? JS_TEMPLATE);
    setRequest(picked.requestMappingTemplate ?? VTL_REQUEST_TEMPLATE);
    setResponse(picked.responseMappingTemplate ?? VTL_RESPONSE_TEMPLATE);
    form.setError("");
    setModal("edit");
  };

  const save = async () => {
    if (!typeName || !fieldName) return form.setError("Choose a type and a field.");
    if (!source) return form.setError("Choose a data source.");
    if (runtime === "APPSYNC_JS" && !code.trim()) return form.setError("Enter the resolver code.");
    if (runtime === "VTL" && (!request.trim() || !response.trim())) return form.setError("Enter the request and the response mapping template.");
    const base = { apiId, typeName, fieldName, dataSourceName: source, kind: "UNIT" as const };
    const ok = await form.run(async () => {
      if (runtime === "APPSYNC_JS") {
        const input = { ...base, runtime: { name: "APPSYNC_JS" as const, runtimeVersion: "1.0.0" }, code };
        if (editing) await appsync.send(new UpdateResolverCommand(input));
        else await appsync.send(new CreateResolverCommand(input));
      } else {
        const input = { ...base, requestMappingTemplate: request, responseMappingTemplate: response };
        if (editing) await appsync.send(new UpdateResolverCommand(input));
        else await appsync.send(new CreateResolverCommand(input));
      }
      notify.success(`The resolver of ${typeName}.${fieldName} was ${editing ? "saved" : "created"}.`);
      setSelected([]);
      data.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      await appsync.send(new DeleteResolverCommand({ apiId, typeName: picked.typeName, fieldName: picked.fieldName }));
      notify.success(`The resolver of ${picked.typeName}.${picked.fieldName} was deleted.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the resolver", e);
    }
    setModal(undefined);
    data.reload(true);
  };

  const blocked = !fields.length ? "Save a schema first." : !sources.length ? "Create a data source first." : "";

  return (
    <>
      <ResourceTable
        title="Resolvers"
        description={blocked || "A resolver connects one field of the schema to a data source."}
        resourceName="resolvers"
        variant="container"
        stickyHeader={false}
        global
        items={data.data?.resolvers}
        loading={data.loading}
        error={data.error}
        onRefresh={() => data.reload()}
        trackBy={(r) => `${r.typeName}.${r.fieldName}`}
        selectionType="single"
        selected={selected}
        onSelect={setSelected}
        emptyAction={
          <Button disabled={!!blocked} onClick={openCreate}>
            Create resolver
          </Button>
        }
        actions={
          <>
            <Button disabled={!picked} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button disabled={!picked || picked.kind === "PIPELINE"} onClick={openEdit}>
              Edit
            </Button>
            <Button disabled={!!blocked} onClick={openCreate}>
              Create resolver
            </Button>
          </>
        }
        columns={[
          { id: "type", header: "Type", cell: (r) => r.typeName, sortingField: "typeName", isRowHeader: true },
          { id: "field", header: "Field", cell: (r) => r.fieldName, sortingField: "fieldName" },
          { id: "source", header: "Data source", cell: (r) => r.dataSourceName ?? "-", sortingField: "dataSourceName" },
          { id: "kind", header: "Kind", cell: (r) => (r.kind === "PIPELINE" ? "Pipeline" : "Unit") },
          { id: "runtime", header: "Runtime", cell: (r) => (runtimeOf(r) === "APPSYNC_JS" ? "APPSYNC_JS" : "VTL") },
        ]}
      />

      <FormModal
        visible={modal === "create" || modal === "edit"}
        size="large"
        header={editing ? `Edit resolver of ${typeName}.${fieldName}` : "Create resolver"}
        submitLabel={editing ? "Save resolver" : "Create resolver"}
        busy={form.busy}
        error={form.error}
        onDismiss={() => setModal(undefined)}
        onSubmit={save}
      >
        <ColumnLayout columns={3}>
          <FormField label="Type">
            <Select
              disabled={editing}
              selectedOption={typeName ? option(typeName) : null}
              onChange={(e) => {
                setTypeName(e.detail.selectedOption.value ?? "");
                setFieldName("");
              }}
              options={typeNames(fields).map(option)}
              placeholder="Choose a type"
            />
          </FormField>
          <FormField label="Field">
            <Select
              disabled={editing}
              selectedOption={fieldName ? option(fieldName) : null}
              onChange={(e) => setFieldName(e.detail.selectedOption.value ?? "")}
              options={freeFields.map((f) => ({ value: f.field, label: f.field, description: f.returns }))}
              placeholder="Choose a field"
              empty="Every field of this type has a resolver."
            />
          </FormField>
          <FormField label="Data source">
            <Select
              selectedOption={source ? option(source) : null}
              onChange={(e) => setSource(e.detail.selectedOption.value ?? "")}
              options={sources.map((d) => ({ value: d.name ?? "", label: d.name ?? "", description: d.type }))}
              placeholder="Choose a data source"
            />
          </FormField>
        </ColumnLayout>
        <FormField label="Resolver runtime">
          <RadioGroup
            value={runtime}
            onChange={(e) => setRuntime(e.detail.value)}
            items={[
              { value: "APPSYNC_JS", label: "AppSync JavaScript (APPSYNC_JS)", description: "One file with a request and a response function." },
              { value: "VTL", label: "Velocity Template Language (VTL)", description: "A request and a response mapping template." },
            ]}
          />
        </FormField>
        {modal && modal !== "delete" && runtime === "APPSYNC_JS" && (
          <FormField label="Resolver code" stretch>
            <Code value={code} onChange={setCode} language="javascript" height={300} ariaLabel="Resolver code" />
          </FormField>
        )}
        {modal && modal !== "delete" && runtime === "VTL" && (
          <>
            <FormField label="Request mapping template" stretch>
              <Code value={request} onChange={setRequest} language="text" height={150} ariaLabel="Request mapping template" />
            </FormField>
            <FormField label="Response mapping template" stretch>
              <Code value={response} onChange={setResponse} language="text" height={120} ariaLabel="Response mapping template" />
            </FormField>
          </>
        )}
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title={`Delete the resolver of ${picked?.typeName}.${picked?.fieldName}?`} onCancel={() => setModal(undefined)} onConfirm={remove}>
        Queries get null for this field after you delete its resolver.
      </ConfirmDelete>
    </>
  );
}
