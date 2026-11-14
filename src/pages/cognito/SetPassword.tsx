import { useEffect, useState } from "react";
import { AdminSetUserPasswordCommand, type PasswordPolicyType } from "@aws-sdk/client-cognito-identity-provider";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { cognito } from "../../clients/cognito";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { checkPassword, policyLines } from "./cognitoutil";

/** Dialog that sets a new password for one or more users. */
export function SetPassword({
  visible,
  poolId,
  usernames,
  policy,
  onDismiss,
  onDone,
}: {
  visible: boolean;
  poolId: string;
  usernames: string[];
  policy?: PasswordPolicyType;
  onDismiss: () => void;
  onDone: () => void;
}) {
  const notify = useNotify();
  const form = useSubmit();
  const [password, setPassword] = useState("");
  const [permanent, setPermanent] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setPassword("");
    setPermanent(true);
    form.setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = async () => {
    const problem = checkPassword(password, policy);
    if (problem) return form.setError(problem);
    const ok = await form.run(async () => {
      for (const Username of usernames) await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username, Password: password, Permanent: permanent }));
      notify.success(usernames.length === 1 ? `The password of ${usernames[0]} was set.` : `The password of ${usernames.length} users was set.`);
      onDone();
    });
    if (ok) onDismiss();
  };

  return (
    <FormModal visible={visible} header="Set password" submitLabel="Set password" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={save}>
      <FormField label="Password" constraintText={policyLines(policy).join(". ") + "."}>
        <Input type="password" value={password} placeholder="Enter a password" onChange={(e) => setPassword(e.detail.value)} />
      </FormField>
      <Checkbox checked={permanent} onChange={(e) => setPermanent(e.detail.checked)} description="Clear this to set a temporary password. The user must then change it at the first sign-in.">
        Make this password permanent
      </Checkbox>
    </FormModal>
  );
}
