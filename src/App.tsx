import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./pages/Layout";
import { Courses } from "./pages/Courses";
import { Quiz } from "./pages/Quiz";
import { Interviews } from "./pages/Interviews";
import { Settings } from "./pages/Settings";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Courses />} />
          <Route path="quiz" element={<Quiz />} />
          <Route path="interviews" element={<Interviews />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
