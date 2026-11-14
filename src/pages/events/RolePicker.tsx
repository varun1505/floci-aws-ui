import Autosuggest from "@cloudscape-design/components/autosuggest";
import { useLoad } from "../../lib/useLoad";
import { listRoles } from "../iam/iamutil";

export const isRoleArn = (arn: string) => /^arn:aws[a-z-]*:iam::\d{12}:role\/.+$/.test(arn);

/** A role ARN field. It suggests the IAM roles of the account, and the user can also type an ARN. */
export function RolePicker({ value, onChange }: { value: string; onChange: (arn: string) => void }) {
  const roles = useLoad(listRoles, []);
  return (
    <Autosuggest
      value={value}
      onChange={(e) => onChange(e.detail.value)}
      options={(roles.data ?? []).map((r) => ({ value: r.Arn ?? "", label: r.RoleName, description: r.Arn }))}
      statusType={roles.loading ? "loading" : roles.error ? "error" : "finished"}
      loadingText="Loading roles"
      errorText="Could not load the roles. Type a role ARN."
      empty="No roles. Type a role ARN."
      enteredTextLabel={(text) => `Use: ${text}`}
      placeholder="arn:aws:iam::000000000000:role/my-role"
      ariaLabel="Role ARN"
    />
  );
}
