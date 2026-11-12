import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Functions from "./pages/lambda/Functions";
import CreateFunction from "./pages/lambda/CreateFunction";
import FunctionDetail from "./pages/lambda/FunctionDetail";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/lambda" element={<Navigate to="/lambda/functions" replace />} />
      <Route path="/lambda/functions" element={<Functions />} />
      <Route path="/lambda/functions/create" element={<CreateFunction />} />
      <Route path="/lambda/functions/:name" element={<FunctionDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
