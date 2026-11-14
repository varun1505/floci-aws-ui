import { KinesisClient } from "@aws-sdk/client-kinesis";
import { clientBase } from "../config";

export const kinesis = new KinesisClient(clientBase);
