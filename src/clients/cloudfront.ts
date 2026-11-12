import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { clientBase } from "../config";

// CloudFront is a global service. Like AWS, it always uses us-east-1.
export const cloudfront = new CloudFrontClient({ ...clientBase, region: "us-east-1" });
