import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Spinner from "@cloudscape-design/components/spinner";
import Home from "./pages/Home";

// Each service loads its own code only when it is first opened. The AWS SDK clients are large.
const Functions = lazy(() => import("./pages/lambda/Functions"));
const CreateFunction = lazy(() => import("./pages/lambda/CreateFunction"));
const FunctionDetail = lazy(() => import("./pages/lambda/FunctionDetail"));
const Buckets = lazy(() => import("./pages/s3/Buckets"));
const BucketObjects = lazy(() => import("./pages/s3/BucketObjects"));
const ObjectDetail = lazy(() => import("./pages/s3/ObjectDetail"));
const LogGroups = lazy(() => import("./pages/cloudwatch/LogGroups"));
const LogGroupDetail = lazy(() => import("./pages/cloudwatch/LogGroupDetail"));
const Alarms = lazy(() => import("./pages/cloudwatch/Alarms"));
const Metrics = lazy(() => import("./pages/cloudwatch/Metrics"));
const Instances = lazy(() => import("./pages/ec2/Instances"));
const LaunchInstance = lazy(() => import("./pages/ec2/LaunchInstance"));
const InstanceDetail = lazy(() => import("./pages/ec2/InstanceDetail"));
const SecurityGroups = lazy(() => import("./pages/ec2/SecurityGroups"));
const SecurityGroupDetail = lazy(() => import("./pages/ec2/SecurityGroupDetail"));
const KeyPairs = lazy(() => import("./pages/ec2/KeyPairs"));
const Images = lazy(() => import("./pages/ec2/Images"));

const loading = (
  <Box textAlign="center" padding="xxxl">
    <Spinner size="large" />
  </Box>
);

export default function App() {
  return (
    <Suspense fallback={loading}>
      <Routes>
        <Route path="/" element={<Home />} />

        <Route path="/lambda" element={<Navigate to="/lambda/functions" replace />} />
        <Route path="/lambda/functions" element={<Functions />} />
        <Route path="/lambda/functions/create" element={<CreateFunction />} />
        <Route path="/lambda/functions/:name" element={<FunctionDetail />} />

        <Route path="/s3" element={<Navigate to="/s3/buckets" replace />} />
        <Route path="/s3/buckets" element={<Buckets />} />
        <Route path="/s3/bucket" element={<BucketObjects />} />
        <Route path="/s3/object" element={<ObjectDetail />} />

        <Route path="/cloudwatch" element={<Navigate to="/cloudwatch/log-groups" replace />} />
        <Route path="/cloudwatch/log-groups" element={<LogGroups />} />
        <Route path="/cloudwatch/log-group" element={<LogGroupDetail />} />
        <Route path="/cloudwatch/alarms" element={<Alarms />} />
        <Route path="/cloudwatch/metrics" element={<Metrics />} />

        <Route path="/ec2" element={<Navigate to="/ec2/instances" replace />} />
        <Route path="/ec2/instances" element={<Instances />} />
        <Route path="/ec2/instances/launch" element={<LaunchInstance />} />
        <Route path="/ec2/instances/:id" element={<InstanceDetail />} />
        <Route path="/ec2/security-groups" element={<SecurityGroups />} />
        <Route path="/ec2/security-groups/:id" element={<SecurityGroupDetail />} />
        <Route path="/ec2/key-pairs" element={<KeyPairs />} />
        <Route path="/ec2/images" element={<Images />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
