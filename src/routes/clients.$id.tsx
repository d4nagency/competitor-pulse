import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Loader2, FileText, AlertCircle, MapPin } from "lucide-react";
import { toast } from "sonner";
import { MONTHS, currentMonth, monthLabel } from "@/lib/months";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/clients/$id")({ component: ClientDetail });

type Client = {
  id: string; name: string; website: string;
  location: string | null; industry: string | null; notes: string | null;
};
type Report = {
  id: string; client_id: string; month: number; year: number;
  status: string; data: any; error: string | null; created_at: string;
};

function ClientDetail() {
  const { id } = useParams({ from: "/clients/$id" });
  const [client, setClient] = useState<Client | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const init = currentMonth();
  const [selMonth, setSelMonth] = useState<number>(init.month);
  const [selYear, setSelYear] = useState<number>(init.year);

  const load = useCallback(async () => {
    const [cRes, rRes] = await Promise.all([
      supabase.from("clients").select("*").eq("id", id).single(),
      supabase.from("reports").select("*").eq("client_id", id).order("year", { ascending: false }).order("month", { ascending: false }),
    ]);
    if (cRes.error) toast.error(cRes.error.message);
    setClient(cRes.data as Client);
    setReports((rRes.data as Report[]) || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll for in-progress reports
  useEffect(() => {
    const pending = reports.some((r) => r.status === "pending");
    if (!pending) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [reports, load]);

  const runAnalysis = async () => {
    if (!client) return;
    setRunning(true);

    // create or get report row
    const { data: existing } = await supabase
      .from("reports").select("*")
      .eq("client_id", id).eq("month", selMonth).eq("year", selYear).maybeSingle();

    let reportId = existing?.id as string | undefined;

    if (existing) {
      if (existing.status === "complete") {
        if (!confirm(`A report for ${monthLabel(selMonth, selYear)} already exists. Re-run and overwrite?`)) {
          setRunning(false);
          return;
        }
      }
      await supabase.from("reports").update({ status: "pending", error: null }).eq("id", existing.id);
    } else {
      const { data: created, error: cErr } = await supabase
        .from("reports")
        .insert({ client_id: id, month: selMonth, year: selYear, status: "pending" })
        .select().single();
      if (cErr || !created) { setRunning(false); return toast.error(cErr?.message || "Failed"); }
      reportId = created.id;
    }

    await load();

    try {
      const { error } = await supabase.functions.invoke("analyze-competitors", {
        body: { reportId },
      });
      if (error) throw error;
      toast.success("Analysis complete");
    } catch (e: any) {
      toast.error(e?.message || "Analysis failed");
    } finally {
      setRunning(false);
      load();
    }
  };

  if (loading) return <Layout><div className="font-mono text-sm text-muted-foreground">Loading…</div></Layout>;
  if (!client) return <Layout><div>Client not found.</div></Layout>;

  const years = [init.year, init.year - 1];

  return (
    <Layout>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="h-4 w-4" /> All clients
      </Link>

      <div className="flex items-end justify-between mb-12 gap-6 flex-wrap">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-3">◆ Client</div>
          <h1 className="font-display text-6xl leading-none">{client.name}</h1>
          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
            <a href={client.website.startsWith("http") ? client.website : `https://${client.website}`}
               target="_blank" rel="noreferrer" className="font-mono hover:text-primary">
              {client.website.replace(/^https?:\/\//, "")} ↗
            </a>
            {client.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{client.location}</span>}
            {client.industry && <span className="font-mono uppercase text-xs tracking-wider">{client.industry}</span>}
          </div>
        </div>

        <div className="flex items-end gap-2 bg-card border border-border rounded-xl p-2">
          <Select value={String(selMonth)} onValueChange={(v) => setSelMonth(Number(v))}>
            <SelectTrigger className="w-36 border-0 bg-transparent"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(selYear)} onValueChange={(v) => setSelYear(Number(v))}>
            <SelectTrigger className="w-24 border-0 bg-transparent"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={runAnalysis} disabled={running} size="lg">
            {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running…</> : <><Sparkles className="h-4 w-4 mr-2" />Run intel</>}
          </Button>
        </div>
      </div>

      <h2 className="font-display text-2xl mb-4">Reports</h2>

      {reports.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No reports yet. Pick a month and run intel.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportRow key={r.id} report={r} />
          ))}
        </div>
      )}
    </Layout>
  );
}

function ReportRow({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-2xl bg-card overflow-hidden">
      <button
        onClick={() => report.status === "complete" && setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors"
        disabled={report.status !== "complete"}
      >
        <div className="flex items-center gap-4">
          <StatusDot status={report.status} />
          <div>
            <div className="font-display text-2xl leading-none">{monthLabel(report.month, report.year)}</div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-1.5">
              {report.status === "complete" && report.data?.competitors
                ? `${report.data.competitors.length} competitors • ${report.data.post_ideas?.length || 0} post ideas`
                : report.status}
            </div>
          </div>
        </div>
        {report.status === "pending" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
        {report.status === "error" && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" /> {report.error}
          </div>
        )}
        {report.status === "complete" && (
          <div className="text-xs font-mono text-muted-foreground">{open ? "− Hide" : "+ View"}</div>
        )}
      </button>
      {open && report.data && <ReportView data={report.data} />}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "complete" ? "bg-primary shadow-[0_0_12px_var(--primary)]" :
    status === "pending" ? "bg-accent animate-pulse" :
    "bg-destructive";
  return <div className={`h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function ReportView({ data }: { data: any }) {
  return (
    <div className="border-t border-border p-6 md:p-8 space-y-10 bg-[var(--gradient-surface)]">
      <Section title="Snapshot" kicker="Overview">
        <p className="text-lg leading-relaxed">{data.client_summary}</p>
        <p className="text-muted-foreground mt-3">{data.market_overview}</p>
      </Section>

      <Section title="Competitors" kicker={`${data.competitors?.length || 0} tracked`}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.competitors?.map((c: any, i: number) => (
            <div key={i} className="rounded-xl border border-border bg-background/40 p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="font-display text-xl">{c.name}</div>
                <ActivityChip score={c.social_activity?.activity_score} />
              </div>
              {c.website && <div className="text-xs font-mono text-muted-foreground mb-3">{c.website}</div>}
              <p className="text-sm text-muted-foreground mb-4">{c.positioning}</p>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <AdBox label="Google Ads" running={c.google_ads?.running} notes={c.google_ads?.notes} />
                <AdBox label="Meta Ads" running={c.meta_ads?.running} notes={c.meta_ads?.notes} />
              </div>

              {c.other_ads && (
                <div className="text-xs text-muted-foreground mb-3">
                  <span className="font-mono uppercase tracking-wider text-foreground">Other:</span> {c.other_ads}
                </div>
              )}

              <div className="space-y-1.5 text-xs">
                {c.social_activity?.instagram && <SocialLine label="IG" text={c.social_activity.instagram} />}
                {c.social_activity?.tiktok && <SocialLine label="TT" text={c.social_activity.tiktok} />}
                {c.social_activity?.facebook && <SocialLine label="FB" text={c.social_activity.facebook} />}
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
                <BulletList title="Strengths" items={c.strengths} tone="primary" />
                <BulletList title="Weaknesses" items={c.weaknesses} tone="destructive" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Opportunities" kicker="Act on this month">
        <ol className="space-y-2.5">
          {data.client_opportunities?.map((o: string, i: number) => (
            <li key={i} className="flex gap-4 p-4 rounded-lg bg-background/40 border border-border">
              <span className="font-mono text-primary text-sm shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-sm">{o}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Post ideas" kicker={`${data.post_ideas?.length || 0} ready to publish`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.post_ideas?.map((p: any, i: number) => (
            <div key={i} className="rounded-xl border border-border bg-background/40 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-widest text-primary px-2 py-1 rounded bg-primary/10">{p.platform}</span>
                <span className="text-xs font-mono text-muted-foreground">#{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="font-display text-lg leading-tight mb-2">{p.hook}</div>
              <p className="text-sm text-muted-foreground mb-3">{p.concept}</p>
              <div className="text-sm whitespace-pre-wrap border-t border-border pt-3 text-foreground/90">{p.caption}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Ad angles to test" kicker="Paid creative">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.ad_angles?.map((a: any, i: number) => (
            <div key={i} className="rounded-xl border border-border bg-background/40 p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-accent px-2 py-1 rounded bg-accent/10">{a.channel}</span>
              </div>
              <div className="font-display text-xl mb-2">{a.angle}</div>
              <div className="text-sm mb-2"><span className="text-muted-foreground font-mono text-xs uppercase tracking-wider">Hook: </span>{a.hook}</div>
              <div className="text-sm"><span className="text-muted-foreground font-mono text-xs uppercase tracking-wider">Offer: </span>{a.offer}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-5 pb-3 border-b border-border">
        <h3 className="font-display text-3xl">{title}</h3>
        {kicker && <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{kicker}</span>}
      </div>
      {children}
    </section>
  );
}

function AdBox({ label, running, notes }: { label: string; running?: string; notes?: string }) {
  const tone =
    running === "yes" ? "border-primary/50 bg-primary/5" :
    running === "likely" ? "border-accent/50 bg-accent/5" :
    "border-border bg-background/30";
  return (
    <div className={`rounded-lg p-3 border ${tone}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
        <span className="text-[10px] font-mono uppercase">{running || "unknown"}</span>
      </div>
      {notes && <div className="text-xs text-muted-foreground leading-relaxed">{notes}</div>}
    </div>
  );
}

function SocialLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <span className="font-mono text-[10px] text-primary mt-0.5 shrink-0 w-6">{label}</span>
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}

function BulletList({ title, items, tone }: { title: string; items?: string[]; tone: "primary" | "destructive" }) {
  const color = tone === "primary" ? "text-primary" : "text-destructive";
  return (
    <div>
      <div className={`text-[10px] font-mono uppercase tracking-widest mb-1.5 ${color}`}>{title}</div>
      <ul className="space-y-1">
        {items?.map((s, i) => <li key={i} className="text-xs text-muted-foreground leading-relaxed">— {s}</li>)}
      </ul>
    </div>
  );
}

function ActivityChip({ score }: { score?: string }) {
  if (!score) return null;
  const map: Record<string, string> = {
    very_active: "bg-primary/15 text-primary",
    active: "bg-primary/10 text-primary",
    moderate: "bg-muted text-muted-foreground",
    low: "bg-muted text-muted-foreground",
    inactive: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded ${map[score] || "bg-muted"}`}>
      {score.replace("_", " ")}
    </span>
  );
}
