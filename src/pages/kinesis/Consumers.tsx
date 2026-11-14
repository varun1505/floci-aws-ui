import { useState } from "react";
import { type Consumer, DeregisterStreamConsumerCommand, ListStreamConsumersCommand, RegisterStreamConsumerCommand } from "@aws-sdk/client-kinesis";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { kinesis } from "../../clients/kinesis";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { NAME_ERROR, NAME_RULE, StreamState } from "./kinesisutil";

async function listConsumers(StreamARN: string): Promise<Consumer[]> {
  const out: Consumer[] = [];
  let NextToken: string | undefined;
  do {
    const res = await kinesis.send(new ListStreamConsumersCommand({ StreamARN, NextToken }));
    out.push(...(res.Consumers ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

/** Enhanced fan-out consumers of a stream: list, register and deregister. */
export function Consumers({ streamArn }: { streamArn: string }) {
  const notify = useNotify();
  const list = useLoad(() => listConsumers(streamArn), [streamArn]);
  const form = useSubmit();
  const [selected, setSelected] = useState<Consumer[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");

  const register = async () => {
    if (!NAME_RULE.test(name)) return form.setError(NAME_ERROR);
    const ok = await form.run(async () => {
      await kinesis.send(new RegisterStreamConsumerCommand({ StreamARN: streamArn, ConsumerName: name }));
      notify.success(`Consumer ${name} was registered.`);
      list.reload(true);
    });
    if (ok) setCreating(false);
  };

  const deregister = async () => {
    const c = selected[0];
    try {
      await kinesis.send(new DeregisterStreamConsumerCommand({ ConsumerARN: c.ConsumerARN }));
      notify.success(`Consumer ${c.ConsumerName} was deregistered.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not deregister the consumer", e);
    }
    setDeleting(false);
    list.reload(true);
  };

  const openCreate = () => {
    setName("");
    form.setError("");
    setCreating(true);
  };

  return (
    <>
      <ResourceTable
        title="Consumers using enhanced fan-out"
        description="Each registered consumer gets its own read throughput from every shard."
        resourceName="consumers"
        variant="container"
        stickyHeader={false}
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(c) => c.ConsumerARN ?? ""}
        selectionType="single"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Register consumer</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Deregister
            </Button>
            <Button onClick={openCreate}>Register consumer</Button>
          </>
        }
        columns={[
          { id: "name", header: "Consumer name", cell: (c) => c.ConsumerName, sortingField: "ConsumerName", isRowHeader: true },
          { id: "status", header: "Registration status", cell: (c) => <StreamState state={c.ConsumerStatus} /> },
          { id: "arn", header: "Consumer ARN", cell: (c) => <Copy text={c.ConsumerARN} /> },
          { id: "created", header: "Registration date", cell: (c) => formatDate(c.ConsumerCreationTimestamp) },
        ]}
      />

      <FormModal visible={creating} header="Register consumer" submitLabel="Register consumer" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={register}>
        <FormField label="Consumer name" constraintText="Letters, numbers, underscores, hyphens and periods.">
          <Input value={name} placeholder="my-consumer" onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={deleting} title={`Deregister ${selected[0]?.ConsumerName ?? "consumer"}?`} confirmText="deregister" actionLabel="Deregister" onCancel={() => setDeleting(false)} onConfirm={deregister}>
        Applications that read with this consumer stop getting records.
      </ConfirmDelete>
    </>
  );
}
