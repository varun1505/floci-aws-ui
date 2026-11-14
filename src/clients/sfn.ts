import { SFNClient } from "@aws-sdk/client-sfn";
import { clientBase } from "../config";

export const sfn = new SFNClient(clientBase);
