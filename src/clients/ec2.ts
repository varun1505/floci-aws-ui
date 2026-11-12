import { EC2Client } from "@aws-sdk/client-ec2";
import { clientBase } from "../config";

export const ec2 = new EC2Client(clientBase);
