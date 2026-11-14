import { ECRClient } from "@aws-sdk/client-ecr";
import { clientBase } from "../config";

export const ecr = new ECRClient(clientBase);
