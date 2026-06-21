// design-sync bundle entry for the ALICE design system.
// ALICE is a Tauri app, not a published package, so there is no dist/ entry to
// point the converter at. This barrel re-exports the design-system components
// straight from src/, giving the converter a single real entry to bundle
// (PKG_DIR resolves to the repo root via the walk-up from this file).
//
// Importing the stylesheets here lets esbuild bundle them into _ds_bundle.css
// with their @imports inlined (tokens first so the :root custom properties are
// defined before the component rules that consume them). ALICE keeps tokens and
// component CSS in src/styles/, not a separate tokens package, so the converter's
// tokensPkg path doesn't apply — this is how the tokens reach the styles.css
// closure that rendered designs receive.
import "../src/styles/tokens.css";
import "../src/styles/components.css";

export * from "../src/components/Badge";
export * from "../src/components/Button";
export * from "../src/components/Card";
export * from "../src/components/Input";
export * from "../src/components/Modal";
export * from "../src/components/Notifications";
export * from "../src/components/ProgressRing";
export * from "../src/components/Select";
export * from "../src/components/Tabs";
