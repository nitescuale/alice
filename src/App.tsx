import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./pages/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Courses } from "./pages/Courses";
import { Quiz } from "./pages/Quiz";
import { Interviews } from "./pages/Interviews";
import { Settings } from "./pages/Settings";
import { GitHubImport } from "./pages/GitHubImport";
import { Import } from "./pages/Import";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Courses />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="quiz" element={<Quiz />} />
          <Route path="interviews" element={<Interviews />} />
          <Route path="import" element={<Import />} />
          <Route path="github-import" element={<GitHubImport />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
