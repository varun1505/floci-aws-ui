import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { clientBase } from "../config";

export const elb = new ElasticLoadBalancingV2Client(clientBase);
