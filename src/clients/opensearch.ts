import { OpenSearchClient } from "@aws-sdk/client-opensearch";
import { clientBase } from "../config";

export const opensearch = new OpenSearchClient(clientBase);
