import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteStackCommand, type StackSummary } from "@aws-sdk/client-cloudformation";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Select from "@cloudscape-design/components/select";
import { cloudformation } from "../../clients/cloudformation";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { CFN_CRUMBS, STATUS_FILTERS, StackStatus, isDeleted, listStacks, stackHref } from "./cfnutil";

export default function Stacks() {
  const navigate = useNavigate();
  const notify = useNotify();
  const stacks = useLoad(listStacks, []);
  const [filter, setFilter] = useState(STATUS_FILTERS[0]);
  const [selected, setSelected] = useState<StackSummary[]>([]);
  const [deleting, setDeleting] = useState(false);

  // Read the selected stack from the fresh list, so its status is current after a reload.
  const stack = stacks.data?.find((s) => s.StackId === selected[0]?.StackId) ?? selected[0];
  const shown = stacks.data?.filter((s) => filter.match(s.StackStatus ?? ""));
  const create = () => navigate("/cloudformation/stacks/create");

  const remove = async () => {
    try {
      await cloudformation.send(new DeleteStackCommand({ StackName: stack.StackName }));
      notify.success(`Delete initiated for ${stack.StackName}.`);
      setSelected([]);
    } catch (e) {
      notify.error(`Could not delete ${stack.StackName}`, e);
    }
    setDeleting(false);
    stacks.reload();
  };

  return (
    <Shell service="cloudformation" contentType="table" breadcrumbs={CFN_CRUMBS}>
      <ResourceTable
        title="Stacks"
        resourceName="stacks"
        filterPlaceholder="Filter by stack name"
        emptyDescription="A stack is a set of resources that you create, change and delete together from one template."
        emptyCli="cloudformation create-stack --stack-name my-stack --template-body file://template.yaml"
        items={shown}
        loading={stacks.loading}
        error={stacks.error}
        onRefresh={() => stacks.reload()}
        trackBy={(s) => s.StackId ?? s.StackName ?? ""}
        selectionType="single"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={create}>Create stack</Button>}
        extraFilter={
          <div style={{ minWidth: 180 }}>
            <Select
              ariaLabel="Filter status"
              selectedOption={filter}
              options={STATUS_FILTERS}
              onChange={(e) => {
                setSelected([]);
                setFilter(STATUS_FILTERS.find((f) => f.value === e.detail.selectedOption.value) ?? STATUS_FILTERS[0]);
              }}
            />
          </div>
        }
        actions={
          <>
            <Button disabled={!stack || isDeleted(stack.StackStatus)} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button disabled={!stack || isDeleted(stack.StackStatus)} onClick={() => navigate(`/cloudformation/stacks/create?update=${encodeURIComponent(stack.StackName ?? "")}`)}>
              Update
            </Button>
            <Button variant="primary" onClick={create}>
              Create stack
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Stack name", cell: (s) => <RouterLink to={stackHref(s)}>{s.StackName}</RouterLink>, sortingField: "StackName", isRowHeader: true },
          { id: "status", header: "Status", cell: (s) => <StackStatus status={s.StackStatus} />, sortingField: "StackStatus" },
          { id: "created", header: "Created time", cell: (s) => formatDate(s.CreationTime), sortingComparator: (a, b) => (a.CreationTime?.getTime() ?? 0) - (b.CreationTime?.getTime() ?? 0) },
          { id: "description", header: "Description", cell: (s) => s.TemplateDescription || "-" },
        ]}
      />

      <ConfirmDelete visible={deleting} title="Delete stack?" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>
          Deleting <b>{stack?.StackName}</b> deletes all the resources of the stack. You can't undo this.
        </Box>
      </ConfirmDelete>
    </Shell>
  );
}
