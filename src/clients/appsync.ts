import { AppSyncClient } from "@aws-sdk/client-appsync";
import { clientBase } from "../config";

export const appsync = new AppSyncClient(clientBase);
