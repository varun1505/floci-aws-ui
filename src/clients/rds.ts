import { RDSClient } from "@aws-sdk/client-rds";
import { clientBase } from "../config";

export const rds = new RDSClient(clientBase);
