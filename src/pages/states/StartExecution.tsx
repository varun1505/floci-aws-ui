import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StartExecutionCommand } from "@aws-sdk/client-sfn";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { sfn } from "../../clients/sfn";
import { Code } from "../../components/Code";
import { FormModal } from "../../components/FormModal";
import { prettyJson } from "../../components/Pair";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { executionHref } from "./sfnutil";

/** The Start execution dialog. It opens the new execution when the call succeeds. */
export function StartExecution({ visible, machineArn, input = "{}", onDismiss }: { visible: boolean; machineArn: string; input?: string; onDismiss: () => void }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const form = useSubmit();
  const [name, setName] = useState("");
  const [text, setText] = useState("{}");

  useEffect(() => {
    if (!visible) return;
    setName("");
    setText(prettyJson(input) || "{}");
    form.setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const start = async () => {
    if (name && !/^[A-Za-z0-9_-]{1,80}$/.test(name)) return form.setError("Use up to 80 letters, numbers, hyphens and underscores in the name.");
    try {
      JSON.parse(text);
    } catch (e) {
      return form.setError(`The input is not valid JSON. ${(e as Error).message}`);
    }
    const ok = await form.run(async () => {
      const res = await sfn.send(new StartExecutionCommand({ stateMachineArn: machineArn, name: name || undefined, input: text }));
      notify.success("Execution started.");
      navigate(executionHref(res.executionArn ?? ""));
    });
    if (ok) onDismiss();
  };

  return (
    <FormModal visible={visible} header="Start execution" submitLabel="Start execution" size="large" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={start}>
      <FormField label="Name - optional" description="Leave empty and Step Functions makes up a name." constraintText="Each execution of a state machine needs its own name.">
        <Input value={name} onChange={(e) => setName(e.detail.value)} />
      </FormField>
      <FormField label="Input - optional" description="The JSON the first state receives." stretch>
        {visible && <Code key={input} value={text} onChange={setText} language="json" height={200} ariaLabel="Input" />}
      </FormField>
    </FormModal>
  );
}
