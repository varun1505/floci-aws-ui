import { IAMClient } from "@aws-sdk/client-iam";
import { clientBase } from "../config";

export const iam = new IAMClient(clientBase);
