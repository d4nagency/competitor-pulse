import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 backdrop-blur sticky top-0 z-40 bg-background/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-[var(--shadow-glow)] group-hover:scale-105 transition-transform">
              <Activity className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display text-xl leading-none">Recon</div>
              <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mt-0.5">
                Competitor Intel
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link
              to="/"
              activeProps={{ className: "text-foreground" }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Clients
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
