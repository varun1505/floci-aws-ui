import { LambdaClient } from "@aws-sdk/client-lambda";
import { clientBase } from "../config";

export const lambda = new LambdaClient(clientBase);
