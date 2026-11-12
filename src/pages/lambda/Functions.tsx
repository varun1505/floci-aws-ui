import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteFunctionCommand, ListFunctionsCommand, type FunctionConfiguration } from "@aws-sdk/client-lambda";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import { lambda } from "../../aws";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

export async function listAllFunctions(): Promise<FunctionConfiguration[]> {
  const out: FunctionConfiguration[] = [];
  let Marker: string | undefined;
  do {
    const res = await lambda.send(new ListFunctionsCommand({ Marker }));
    out.push(...(res.Functions ?? []));
    Marker = res.NextMarker;
  } while (Marker);
  return out;
}

export default function Functions() {
  const navigate = useNavigate();
  const notify = useNotify();
  const fns = useLoad(listAllFunctions, []);
  const [selected, setSelected] = useState<FunctionConfiguration[]>([]);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    try {
      for (const f of selected) await lambda.send(new DeleteFunctionCommand({ FunctionName: f.FunctionName }));
      notify.success(`Deleted ${selected.length} function${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete function", e);
    }
    setDeleting(false);
    fns.reload();
  };

  return (
    <Shell service="lambda" contentType="table" breadcrumbs={[{ text: "Lambda", href: "/lambda/functions" }, { text: "Functions", href: "/lambda/functions" }]}>
      <ResourceTable
        title="Functions"
        resourceName="functions"
        filterPlaceholder="Filter by function name, runtime or description"
        items={fns.data}
        loading={fns.loading}
        error={fns.error}
        onRefresh={() => fns.reload()}
        trackBy={(f) => f.FunctionName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => navigate("/lambda/functions/create")}>Create function</Button>}
        actions={
          <>
            <ButtonDropdown
              disabled={selected.length === 0}
              items={[
                { id: "view", text: "View details", disabled: selected.length !== 1 },
                { id: "test", text: "Test", disabled: selected.length !== 1 },
                { id: "delete", text: "Delete" },
              ]}
              onItemClick={(e) => {
                if (e.detail.id === "delete") setDeleting(true);
                if (e.detail.id === "view") navigate(`/lambda/functions/${selected[0].FunctionName}`);
                if (e.detail.id === "test") navigate(`/lambda/functions/${selected[0].FunctionName}?tab=test`);
              }}
            >
              Actions
            </ButtonDropdown>
            <Button variant="primary" onClick={() => navigate("/lambda/functions/create")}>
              Create function
            </Button>
          </>
        }
        columns={[
          {
            id: "name",
            header: "Function name",
            cell: (f) => <RouterLink to={`/lambda/functions/${f.FunctionName}`}>{f.FunctionName}</RouterLink>,
            sortingField: "FunctionName",
            isRowHeader: true,
          },
          { id: "description", header: "Description", cell: (f) => f.Description || "-" },
          { id: "package", header: "Package type", cell: (f) => f.PackageType ?? "Zip" },
          { id: "runtime", header: "Runtime", cell: (f) => f.Runtime ?? "-", sortingField: "Runtime" },
          { id: "size", header: "Code size", cell: (f) => formatBytes(f.CodeSize), sortingField: "CodeSize" },
          { id: "modified", header: "Last modified", cell: (f) => formatDate(f.LastModified), sortingField: "LastModified" },
        ]}
      />
      <ConfirmDelete
        visible={deleting}
        title={`Delete ${selected.length === 1 ? selected[0].FunctionName : `${selected.length} functions`}`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting a function permanently removes the function code. The related logs remain in CloudWatch."
      />
    </Shell>
  );
}
