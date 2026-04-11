import { NavLink, Outlet } from "react-router-dom";
import {
  BookOpen,
  Brain,
  MessageSquare,
  Settings,
  BarChart3,
  GitBranch,
  Upload,
} from "lucide-react";

export function Layout() {
  return (
    <div className="alice-layout">
      <aside className="alice-sidebar">
        {/* Brand */}
        <div className="alice-sidebar__brand">
          <div className="alice-sidebar__logo">
            <div className="alice-sidebar__logo-mark">A</div>
            <div className="alice-sidebar__logo-text">
              <span className="alice-sidebar__logo-name">ALICE</span>
              <span className="alice-sidebar__logo-tagline">
                Learning & Coaching
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="alice-sidebar__nav">
          <span className="alice-sidebar__nav-section">Apprentissage</span>

          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `alice-sidebar__link ${isActive ? "alice-sidebar__link--active" : ""}`
            }
          >
            <span className="alice-sidebar__link-icon">
              <BarChart3 size={18} />
            </span>
            Tableau de bord
          </NavLink>

          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `alice-sidebar__link ${isActive ? "alice-sidebar__link--active" : ""}`
            }
          >
            <span className="alice-sidebar__link-icon">
              <BookOpen size={18} />
            </span>
            Cours
          </NavLink>

          <NavLink
            to="/quiz"
            className={({ isActive }) =>
              `alice-sidebar__link ${isActive ? "alice-sidebar__link--active" : ""}`
            }
          >
            <span className="alice-sidebar__link-icon">
              <Brain size={18} />
            </span>
            Quiz
          </NavLink>

          <span className="alice-sidebar__nav-section">Pratique</span>

          <NavLink
            to="/interviews"
            className={({ isActive }) =>
              `alice-sidebar__link ${isActive ? "alice-sidebar__link--active" : ""}`
            }
          >
            <span className="alice-sidebar__link-icon">
              <MessageSquare size={18} />
            </span>
            Interviews
          </NavLink>

          <span className="alice-sidebar__nav-section">Importer</span>

          <NavLink
            to="/import"
            className={({ isActive }) =>
              `alice-sidebar__link ${isActive ? "alice-sidebar__link--active" : ""}`
            }
          >
            <span className="alice-sidebar__link-icon">
              <Upload size={18} />
            </span>
            Cours (NotebookLM)
          </NavLink>

          <NavLink
            to="/github-import"
            className={({ isActive }) =>
              `alice-sidebar__link ${isActive ? "alice-sidebar__link--active" : ""}`
            }
          >
            <span className="alice-sidebar__link-icon">
              <GitBranch size={18} />
            </span>
            GitHub
          </NavLink>

          <div style={{ flex: 1 }} />

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `alice-sidebar__link ${isActive ? "alice-sidebar__link--active" : ""}`
            }
          >
            <span className="alice-sidebar__link-icon">
              <Settings size={18} />
            </span>
            Reglages
          </NavLink>
        </nav>

        {/* Footer */}
        <div className="alice-sidebar__footer">
          <span className="alice-sidebar__version">v0.1.0 &mdash; Tauri 2</span>
        </div>
      </aside>

      <main className="alice-main">
        <div className="alice-main__content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
