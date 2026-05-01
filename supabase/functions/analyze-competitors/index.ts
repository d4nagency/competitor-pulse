// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a senior digital marketing strategist for an agency producing a real, verifiable monthly competitor analysis.

CRITICAL RULES:
- ONLY include competitors that REALLY exist (provided in the verified list).
- Never fabricate company names, URLs, follower counts, ad creatives, or post counts.
- For ad activity / post counts: if it cannot be verified from the research provided, mark "unknown" — do not guess.
- Return output via the provided tool call. Never reply in plain text.`;

const TOOL = {
  type: "function",
  function: {
    name: "competitor_analysis_report",
    description: "Structured monthly competitor analysis report",
    parameters: {
      type: "object",
      properties: {
        client_summary: { type: "string" },
        market_overview: { type: "string" },
        competitors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              website: { type: "string" },
              positioning: { type: "string" },
              google_ads: {
                type: "object",
                properties: {
                  running: { type: "string", enum: ["yes", "no", "unknown"], description: "yes ONLY if active ads confirmed in Meta Ad Library. no if confirmed not running. unknown otherwise. NEVER 'likely'." },
                  ads_seen_count: { type: "string", description: "Number of ads visible in Google Ads Transparency Center, or 'unknown'." },
                  formats: { type: "array", items: { type: "string", enum: ["text", "image", "video", "shopping", "demand_gen", "unknown"] } },
                  regions: { type: "array", items: { type: "string" }, description: "Regions targeted, e.g. United States, California." },
                  themes: { type: "array", items: { type: "string" }, description: "Recurring messaging / offer themes seen in their ads." },
                  example_headlines: { type: "array", items: { type: "string" }, description: "Verbatim ad headlines or copy snippets observed." },
                  transparency_url: { type: "string", description: "Direct link to their Google Ads Transparency Center page." },
                  notes: { type: "string" },
                },
                required: ["running", "notes"],
              },
              meta_ads: {
                type: "object",
                properties: {
                  running: { type: "string", enum: ["yes", "no", "unknown"], description: "yes ONLY if ads are confirmed via Transparency Center. no if confirmed not running. unknown otherwise. NEVER 'likely'." },
                  active_ads_count: { type: "string", description: "Number of active ads in Meta Ad Library, or 'unknown'." },
                  themes: { type: "array", items: { type: "string" } },
                  ad_library_url: { type: "string" },
                  notes: { type: "string" },
                },
                required: ["running", "notes"],
              },
              other_ads: { type: "string" },
              social_activity: {
                type: "object",
                properties: {
                  instagram_handle: { type: "string" },
                  instagram_url: { type: "string" },
                  instagram_followers: { type: "string", description: "Followers as a string e.g. '12.4K', or 'unknown'." },
                  instagram_posts_this_month: { type: "string", description: "Number of feed posts + reels published this month, or 'unknown'. Be honest." },
                  instagram_post_themes: { type: "array", items: { type: "string" }, description: "Themes / formats observed in this month's posts." },
                  tiktok: { type: "string" },
                  facebook: { type: "string" },
                  activity_score: { type: "string", enum: ["very_active", "active", "moderate", "low", "inactive", "unknown"] },
                },
                required: ["activity_score"],
              },
              strengths: { type: "array", items: { type: "string" } },
              weaknesses: { type: "array", items: { type: "string" } },
            },
            required: ["name", "positioning", "google_ads", "meta_ads", "social_activity", "strengths", "weaknesses"],
          },
        },
        client_opportunities: { type: "array", items: { type: "string" } },
        post_ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform: { type: "string", enum: ["Instagram", "TikTok", "Facebook", "Reels", "Story"] },
              hook: { type: "string" },
              concept: { type: "string" },
              caption: { type: "string" },
            },
            required: ["platform", "hook", "concept", "caption"],
          },
        },
        ad_angles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              angle: { type: "string" },
              channel: { type: "string", enum: ["Google", "Meta", "TikTok", "YouTube"] },
              hook: { type: "string" },
              offer: { type: "string" },
            },
            required: ["angle", "channel", "hook", "offer"],
          },
        },
      },
      required: ["client_summary", "market_overview", "competitors", "client_opportunities", "post_ideas", "ad_angles"],
    },
  },
};

async function callGemini(LOVABLE_API_KEY: string, model: string, messages: any[], grounded = false) {
  const body: any = { model, messages };
  if (grounded) body.tools = [{ type: "google_search_retrieval" }];
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err: any = new Error(`AI ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let reportIdOuter: string | undefined;
  try {
    const { reportId } = await req.json();
    reportIdOuter = reportId;
    if (!reportId) throw new Error("reportId required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing env");

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: report, error: rErr } = await sb
      .from("reports").select("*, clients(*)").eq("id", reportId).single();
    if (rErr || !report) throw new Error("Report not found");

    const c = report.clients;
    const monthName = new Date(report.year, report.month - 1, 1).toLocaleString("en-US", { month: "long" });

    // ============================================================
    // PASS 1 — find real competitors
    // ============================================================
    const researchPrompt = `Find REAL local competitors for this business. Use Google Search to verify each.

Client: ${c.name}
Website: ${c.website}
Location: ${c.location || "unspecified"}
Industry: ${c.industry || "infer from the website"}
Notes: ${c.notes || "none"}

Steps:
1. Search "${c.name}" to understand what they sell.
2. Search direct LOCAL competitors in ${c.location || "their area"}.
3. Verify each by finding their actual website.
4. Return 4-6 verified competitors as a numbered list:
   Name | Website URL | One-sentence description

Quality > quantity. No invented businesses.`;

    const researchText = await callGemini(LOVABLE_API_KEY, "google/gemini-2.5-flash", [
      { role: "system", content: "You are a research assistant. Use web search to verify every fact. Never invent businesses or URLs." },
      { role: "user", content: researchPrompt },
    ], true);
    console.log("Pass 1 competitors:\n", researchText.slice(0, 1500));

    if (!researchText || researchText.length < 50) throw new Error("Research step returned no usable competitor data");

    // Parse competitor list (rough extraction of name + url)
    const competitorLines = researchText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /https?:\/\//i.test(l) || /\|/.test(l))
      .slice(0, 6);

    // ============================================================
    // PASS 2 — DEEP DIVE per competitor (Google Ads Transparency + IG post count)
    // ============================================================
    const deepDives: string[] = [];
    for (const line of competitorLines) {
      const divePrompt = `Deep-dive research on this competitor. Use Google Search aggressively. Be honest — if you can't verify, say "unknown".

Competitor: ${line}
Client context: ${c.name} (${c.website}) in ${c.location || "unspecified"}.

Find and report ALL of the following. Cite the source URL inline for each fact:

A) GOOGLE ADS TRANSPARENCY CENTER
- Search: site:adstransparency.google.com "<competitor name>" OR query their Transparency Center directly.
- Provide the exact Transparency Center URL for this advertiser if found.
- How many ads are currently visible? Approximate count is fine.
- What ad formats? (text, image, video, shopping, demand gen)
- What regions are they targeting?
- List 3-6 verbatim ad headlines or copy snippets you can see.
- Recurring offers / themes / hooks.

B) META AD LIBRARY
- Search Meta Ad Library for the competitor.
- Provide the Ad Library URL.
- How many ACTIVE ads right now?
- Themes / offers observed.

C) INSTAGRAM ACTIVITY THIS MONTH (${monthName} ${report.year})
- Find their Instagram handle and URL.
- Approximate follower count.
- HOW MANY POSTS (feed + reels) did they publish in ${monthName} ${report.year}? Give a number or range. If you can only see "recent" posts not dated, estimate from posting cadence and say so.
- List the themes/formats of those posts (e.g. "3 reels of staff, 2 carousels of promotions").

D) TIKTOK & FACEBOOK presence in 1 line each.

Format clearly with section headers A/B/C/D. Cite URLs.`;

      try {
        const out = await callGemini(LOVABLE_API_KEY, "google/gemini-2.5-flash", [
          { role: "system", content: "You are a research analyst. Use web search. Cite URLs. Mark anything unverified as 'unknown'." },
          { role: "user", content: divePrompt },
        ], true);
        deepDives.push(`### ${line}\n${out}`);
        console.log(`Deep dive for ${line.slice(0, 60)}: ${out.length} chars`);
      } catch (e) {
        console.error("Deep dive failed for", line, e);
        deepDives.push(`### ${line}\n(deep dive failed: ${(e as Error).message})`);
      }
    }

    const deepResearch = deepDives.join("\n\n---\n\n");

    // ============================================================
    // PASS 3 — STRUCTURE the final report
    // ============================================================
    const userPrompt = `Build a ${monthName} ${report.year} competitor analysis for this client using ONLY the verified research below.

CLIENT:
Name: ${c.name}
Website: ${c.website}
Location: ${c.location || "unspecified"}
Industry: ${c.industry || "infer"}
Notes: ${c.notes || "none"}

VERIFIED COMPETITOR LIST:
${researchText}

DEEP DIVE RESEARCH (Google Ads Transparency + Meta Ad Library + Instagram post counts):
${deepResearch}

Rules:
- Use the EXACT names/URLs from the verified list. Do NOT add competitors not in the list.
- For each competitor, populate google_ads (running, ads_seen_count, formats, regions, themes, example_headlines, transparency_url) from the deep dive. If the dive says unknown, set "unknown".
- Populate meta_ads (running, active_ads_count, themes, ad_library_url) the same way.
- Populate social_activity.instagram_handle, instagram_url, instagram_followers, instagram_posts_this_month, instagram_post_themes from the deep dive.
- Be honest. "unknown" is acceptable and preferred over guessing.

Then give the client:
- 5-7 actionable opportunities for ${monthName}
- 8-12 ready-to-publish post ideas (full caption + hashtags)
- 4-6 paid ad creative angles (channel, hook, offer)

Return via the competitor_analysis_report tool.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "competitor_analysis_report" } },
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("AI gateway error", aiRes.status, text);
      let msg = `AI error ${aiRes.status}`;
      if (aiRes.status === 429) msg = "Rate limit hit. Try again in a minute.";
      if (aiRes.status === 402) msg = "AI credits exhausted. Add credits in Settings → Workspace → Usage.";
      await sb.from("reports").update({ status: "error", error: msg }).eq("id", reportId);
      return new Response(JSON.stringify({ error: msg }), { status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const json = await aiRes.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured output");
    const parsed = JSON.parse(toolCall.function.arguments);

    await sb.from("reports").update({ status: "complete", data: parsed, error: null }).eq("id", reportId);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("analyze-competitors error", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    try {
      if (reportIdOuter) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await sb.from("reports").update({ status: "error", error: msg }).eq("id", reportIdOuter);
      }
    } catch {}
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
