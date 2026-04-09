import { Link, Outlet } from "react-router-dom";
import "./layout.css";

export function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <strong>ALICE</strong>
          <span className="tagline">Adaptive Learning & Interview Coaching</span>
        </div>
        <nav>
          <Link to="/">Cours</Link>
          <Link to="/quiz">Quiz</Link>
          <Link to="/interviews">Interviews</Link>
          <Link to="/settings">Réglages</Link>
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
