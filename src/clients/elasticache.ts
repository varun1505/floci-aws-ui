import { ElastiCacheClient } from "@aws-sdk/client-elasticache";
import { clientBase } from "../config";

export const elasticache = new ElastiCacheClient(clientBase);
