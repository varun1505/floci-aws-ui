import { S3Client } from "@aws-sdk/client-s3";
import { clientBase } from "../config";

export const s3 = new S3Client({
  ...clientBase,
  // floci has no per-bucket hostnames, so the bucket goes in the path.
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
