import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, ArrowUpRight, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({ component: ClientsPage });

type Client = {
  id: string; name: string; website: string;
  location: string | null; industry: string | null; notes: string | null;
};

function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("clients").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setClients((data as Client[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}? This removes all reports too.`)) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Client removed");
    load();
  };

  return (
    <Layout>
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-3">
            ◆ Agency Dashboard
          </div>
          <h1 className="font-display text-6xl leading-none">Your clients.</h1>
          <p className="text-muted-foreground mt-3 max-w-md">
            Run AI-powered monthly competitor intel — ads, socials, opportunities and post ideas.
          </p>
        </div>
        <NewClientDialog open={open} setOpen={setOpen} onCreated={load} />
      </div>

      {loading ? (
        <div className="text-muted-foreground font-mono text-sm">Loading…</div>
      ) : clients.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl p-16 text-center">
          <div className="font-display text-3xl mb-2">No clients yet</div>
          <p className="text-muted-foreground mb-6">Add your first client to start running monthly intel.</p>
          <Button onClick={() => setOpen(true)} size="lg">
            <Plus className="h-4 w-4 mr-2" /> Add client
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {clients.map((c) => (
            <div
              key={c.id}
              className="group relative rounded-2xl border border-border bg-card p-6 hover:border-primary/50 transition-all hover:shadow-[var(--shadow-elegant)] cursor-pointer"
              onClick={() => router.navigate({ to: "/clients/$id", params: { id: c.id } })}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="font-display text-2xl leading-tight">{c.name}</div>
                  <a
                    href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
                    target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors mt-1 inline-block"
                  >
                    {c.website.replace(/^https?:\/\//, "")} ↗
                  </a>
                </div>
                <ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </div>

              {(c.location || c.industry) && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground border-t border-border pt-4">
                  {c.location && (
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.location}</span>
                  )}
                  {c.industry && <span className="font-mono uppercase tracking-wider">{c.industry}</span>}
                </div>
              )}

              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(c.id, c.name); }}
                className="absolute top-4 right-12 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
                aria-label="Delete client"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

function NewClientDialog({
  open, setOpen, onCreated,
}: { open: boolean; setOpen: (b: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", website: "", location: "", industry: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim() || !form.website.trim()) {
      return toast.error("Name and website required");
    }
    setSaving(true);
    const { error } = await supabase.from("clients").insert({
      name: form.name.trim(),
      website: form.website.trim(),
      location: form.location.trim() || null,
      industry: form.industry.trim() || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Client added");
    setForm({ name: "", website: "", location: "", industry: "", notes: "" });
    setOpen(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg"><Plus className="h-4 w-4 mr-2" /> New client</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Add a client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <Field label="Name *">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Liquid Life LA" />
          </Field>
          <Field label="Website *">
            <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="liquidlifela.com" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Los Angeles, CA" />
            </Field>
            <Field label="Industry">
              <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="IV therapy / wellness" />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Target audience, USPs, anything that helps the AI focus."
              rows={3}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Add client"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
