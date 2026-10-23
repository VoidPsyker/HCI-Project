import { useEffect, useState, type ReactNode } from "react";
import { AdminDashboard } from "./admin/AdminDashboard";
import { ExperimentRunner } from "./ExperimentRunner";
import { Home } from "./Home";
import { MenuLab } from "./lab/MenuLab";

function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

function StageFrame({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return (
    <div className="stage-viewport">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

export function App() {
  const path = usePath();
  useEffect(() => {
    document.title =
      path === "/admin"
        ? "Researcher console · Meridian"
        : path === "/lab"
          ? "Menu lab · Meridian"
          : "Meridian Timepieces · pilot";
  }, [path]);

  if (path === "/admin") return <AdminDashboard />;
  if (path === "/lab") return <MenuLab />;
  const runMatch = path.match(/^\/run\/([^/]+)\/?$/);
  if (runMatch?.[1]) {
    return (
      <StageFrame>
        <ExperimentRunner sessionId={decodeURIComponent(runMatch[1])} />
      </StageFrame>
    );
  }
  return <Home />;
}
