import { ACMClient } from "@aws-sdk/client-acm";
import { clientBase } from "../config";

export const acm = new ACMClient(clientBase);
