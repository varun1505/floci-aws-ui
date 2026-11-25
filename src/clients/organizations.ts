import { OrganizationsClient } from "@aws-sdk/client-organizations";
import { clientBase } from "../config";

export const organizations = new OrganizationsClient(clientBase);
