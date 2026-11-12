import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Functions from "./pages/lambda/Functions";
import CreateFunction from "./pages/lambda/CreateFunction";
import FunctionDetail from "./pages/lambda/FunctionDetail";
import Buckets from "./pages/s3/Buckets";
import BucketObjects from "./pages/s3/BucketObjects";
import ObjectDetail from "./pages/s3/ObjectDetail";
import LogGroups from "./pages/cloudwatch/LogGroups";
import LogGroupDetail from "./pages/cloudwatch/LogGroupDetail";
import Alarms from "./pages/cloudwatch/Alarms";
import Metrics from "./pages/cloudwatch/Metrics";
import Instances from "./pages/ec2/Instances";
import LaunchInstance from "./pages/ec2/LaunchInstance";
import InstanceDetail from "./pages/ec2/InstanceDetail";
import SecurityGroups from "./pages/ec2/SecurityGroups";
import SecurityGroupDetail from "./pages/ec2/SecurityGroupDetail";
import KeyPairs from "./pages/ec2/KeyPairs";
import Images from "./pages/ec2/Images";

export default function App() {
  return (
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
  );
}
