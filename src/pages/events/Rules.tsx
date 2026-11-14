import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DisableRuleCommand, EnableRuleCommand, type Rule } from "@aws-sdk/client-eventbridge";
import Button from "@cloudscape-design/components/button";
import Select from "@cloudscape-design/components/select";
import { eventbridge } from "../../clients/eventbridge";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { RuleForm } from "./RuleForm";
import { DEFAULT_BUS, RuleState, deleteRule, listBuses, listRules, ruleHref, ruleType } from "./eventsutil";

export default function Rules() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [params, setParams] = useSearchParams();
  const bus = params.get("bus") || DEFAULT_BUS;
  const buses = useLoad(async () => (await listBuses()).map((b) => b.Name ?? ""), []);
  const list = useLoad(() => listRules(bus), [bus]);
  const [selected, setSelected] = useState<Rule[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const plural = selected.length === 1 ? "" : "s";

  const toggle = async (enable: boolean) => {
    try {
      for (const r of selected) {
        if (enable) await eventbridge.send(new EnableRuleCommand({ Name: r.Name, EventBusName: bus }));
        else await eventbridge.send(new DisableRuleCommand({ Name: r.Name, EventBusName: bus }));
      }
      notify.success(`${enable ? "Enabled" : "Disabled"} ${selected.length} rule${plural}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not update the rule", e);
    }
    list.reload();
  };

  const remove = async () => {
    try {
      for (const r of selected) await deleteRule(r.Name ?? "", bus);
      notify.success(`Deleted ${selected.length} rule${plural} and the targets.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the rule", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="events" contentType="table" breadcrumbs={[{ text: "Amazon EventBridge", href: "/events/rules" }, { text: "Rules", href: "/events/rules" }]}>
      <ResourceTable
        title="Rules"
        resourceName="rules"
        filterPlaceholder="Find rules"
        emptyDescription="A rule watches an event bus and sends matching events to its targets. A rule can also run on a schedule."
        emptyCli={`events put-rule --name my-rule --event-pattern '{"source":["my.app"]}'`}
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(r) => r.Name ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        extraFilter={
          <Select
            selectedOption={{ value: bus, label: `Event bus: ${bus}` }}
            onChange={(e) => {
              setSelected([]);
              setParams(e.detail.selectedOption.value === DEFAULT_BUS ? {} : { bus: e.detail.selectedOption.value ?? "" }, { replace: true });
            }}
            options={(buses.data ?? [bus]).map((value) => ({ value, label: value }))}
            ariaLabel="Event bus"
          />
        }
        emptyAction={<Button onClick={() => setCreating(true)}>Create rule</Button>}
        actions={
          <>
            <Button disabled={!selected.some((r) => r.State === "DISABLED")} onClick={() => toggle(true)}>
              Enable
            </Button>
            <Button disabled={!selected.some((r) => r.State !== "DISABLED")} onClick={() => toggle(false)}>
              Disable
            </Button>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create rule
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (r) => <RouterLink to={ruleHref(r.Name ?? "", bus)}>{r.Name}</RouterLink>, sortingField: "Name", isRowHeader: true },
          { id: "status", header: "Status", cell: (r) => <RuleState state={r.State} />, sortingField: "State" },
          { id: "type", header: "Type", cell: (r) => ruleType(r), sortingComparator: (a, b) => ruleType(a).localeCompare(ruleType(b)) },
          { id: "schedule", header: "Schedule", cell: (r) => r.ScheduleExpression ?? "-" },
          { id: "bus", header: "Event bus", cell: (r) => r.EventBusName ?? bus },
          { id: "description", header: "Description", cell: (r) => r.Description || "-" },
        ]}
      />

      <RuleForm
        visible={creating}
        bus={bus}
        buses={buses.data ?? [bus]}
        onDismiss={() => setCreating(false)}
        onSaved={(name, ruleBus) => {
          setCreating(false);
          notify.success(`Rule ${name} was created. Add a target to send its events somewhere.`);
          navigate(ruleHref(name, ruleBus));
        }}
      />

      <ConfirmDelete visible={deleting} title={`Delete rule${plural}`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        Delete {selected.length === 1 ? <b>{selected[0].Name}</b> : `${selected.length} rules`} permanently? EventBridge can't delete a rule that has targets. So the console removes the targets of the rule first. The target resources themselves are not deleted.
      </ConfirmDelete>
    </Shell>
  );
}
