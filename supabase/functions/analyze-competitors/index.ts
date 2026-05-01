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
- ONLY include competitors that REALLY exist. Use web search to find them.
- Every competitor must have a real, working website URL you found via search.
- If you cannot verify a business is real, DO NOT include it.
- It's better to return 3 real competitors than 8 invented ones.
- For ad activity: be honest. If you cannot verify they're running ads, mark "unknown" — do not guess.
- For social activity: only describe what you actually found.
- Never fabricate company names, URLs, follower counts, or ad creatives.

Always return output via the provided tool call. Never reply in plain text.`;

const TOOL = {
  type: "function",
  function: {
    name: "competitor_analysis_report",
    description: "Structured monthly competitor analysis report",
    parameters: {
      type: "object",
      properties: {
        client_summary: {
          type: "string",
          description: "1-2 sentence overview of the client's positioning and likely target audience.",
        },
        market_overview: {
          type: "string",
          description: "Short paragraph on the local competitive landscape this month.",
        },
        competitors: {
          type: "array",
          description: "5-8 most relevant local competitors.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              website: { type: "string" },
              positioning: { type: "string", description: "How they position themselves vs the client." },
              google_ads: {
                type: "object",
                properties: {
                  running: { type: "string", enum: ["yes", "likely", "no", "unknown"] },
                  notes: { type: "string", description: "Estimated ad themes, keywords, landing pages." },
                },
                required: ["running", "notes"],
              },
              meta_ads: {
                type: "object",
                properties: {
                  running: { type: "string", enum: ["yes", "likely", "no", "unknown"] },
                  notes: { type: "string", description: "Likely creative angles, offers, audience targeting." },
                },
                required: ["running", "notes"],
              },
              other_ads: {
                type: "string",
                description: "TikTok, YouTube, OOH, influencer, etc. activity if relevant.",
              },
              social_activity: {
                type: "object",
                properties: {
                  instagram: { type: "string", description: "Posting frequency this month + content themes." },
                  tiktok: { type: "string" },
                  facebook: { type: "string" },
                  activity_score: {
                    type: "string",
                    enum: ["very_active", "active", "moderate", "low", "inactive"],
                  },
                },
                required: ["activity_score"],
              },
              strengths: { type: "array", items: { type: "string" } },
              weaknesses: { type: "array", items: { type: "string" } },
            },
            required: [
              "name",
              "positioning",
              "google_ads",
              "meta_ads",
              "social_activity",
              "strengths",
              "weaknesses",
            ],
          },
        },
        client_opportunities: {
          type: "array",
          description: "5-7 specific opportunities the client should act on this month.",
          items: { type: "string" },
        },
        post_ideas: {
          type: "array",
          description: "8-12 ready-to-use social post ideas tailored for the client.",
          items: {
            type: "object",
            properties: {
              platform: { type: "string", enum: ["Instagram", "TikTok", "Facebook", "Reels", "Story"] },
              hook: { type: "string", description: "Scroll-stopping opening line / visual." },
              concept: { type: "string", description: "What the post is about and why it works." },
              caption: { type: "string", description: "Ready-to-post caption with hashtags." },
            },
            required: ["platform", "hook", "concept", "caption"],
          },
        },
        ad_angles: {
          type: "array",
          description: "4-6 paid ad creative angles the client should test.",
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
      required: [
        "client_summary",
        "market_overview",
        "competitors",
        "client_opportunities",
        "post_ideas",
        "ad_angles",
      ],
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { reportId } = await req.json();
    if (!reportId) throw new Error("reportId required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Missing env");
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: report, error: rErr } = await sb
      .from("reports")
      .select("*, clients(*)")
      .eq("id", reportId)
      .single();
    if (rErr || !report) throw new Error("Report not found");

    const c = report.clients;
    const monthName = new Date(report.year, report.month - 1, 1).toLocaleString("en-US", {
      month: "long",
    });

    // ============================================================
    // PASS 1 — RESEARCH: get a list of REAL competitors (with Google Search grounding)
    // ============================================================
    const researchPrompt = `Research the local market for this business and return a list of REAL competitors. Use Google Search to verify each one exists.

Client: ${c.name}
Website: ${c.website}
Location: ${c.location || "not specified"}
Industry: ${c.industry || "infer from the website"}
Notes: ${c.notes || "none"}

TASK:
1. First, search the web for "${c.name}" to understand what they actually sell.
2. Then search for direct LOCAL competitors in ${c.location || "their area"} — businesses offering similar products/services to similar customers.
3. Verify each competitor exists by finding their actual website.
4. Return 4-7 verified competitors as a numbered list. For each, give:
   Name | Website URL | One-sentence description of what they do

Do NOT invent businesses. If you can only find 4 real competitors, return 4. Quality > quantity.`;

    const researchRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a research assistant. You MUST use web search to verify every fact. Never invent businesses, URLs, or facts. If unsure, say so." },
          { role: "user", content: researchPrompt },
        ],
        tools: [{ type: "google_search_retrieval" }],
      }),
    });

    if (!researchRes.ok) {
      const text = await researchRes.text();
      console.error("Research call error", researchRes.status, text);
      let msg = `Research error ${researchRes.status}`;
      if (researchRes.status === 429) msg = "Rate limit hit. Try again in a minute.";
      if (researchRes.status === 402) msg = "AI credits exhausted. Add credits in Settings → Workspace → Usage.";
      await sb.from("reports").update({ status: "error", error: msg }).eq("id", reportId);
      return new Response(JSON.stringify({ error: msg }), {
        status: researchRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const researchJson = await researchRes.json();
    const researchText = researchJson.choices?.[0]?.message?.content || "";
    console.log("Research output:", researchText.slice(0, 1000));

    if (!researchText || researchText.length < 50) {
      throw new Error("Research step returned no usable competitor data");
    }

    // ============================================================
    // PASS 2 — STRUCTURE: build the full report ONLY from researched competitors
    // ============================================================
    const userPrompt = `Build a ${monthName} ${report.year} competitor analysis for this client.

CLIENT:
Name: ${c.name}
Website: ${c.website}
Location: ${c.location || "not specified"}
Industry: ${c.industry || "infer from website"}
Notes: ${c.notes || "none"}

VERIFIED COMPETITORS (researched from the web — use ONLY these, do not add or invent any others):
${researchText}

For each verified competitor above:
- Use the exact name and website URL from the research.
- Assess Google Ads + Meta Ads activity. If you don't actually know, mark "unknown" — do NOT guess.
- Describe social activity only at a level you can reasonably infer from the type of business; otherwise say "unknown".
- List honest strengths and weaknesses vs the client.

Then give the client:
- 5-7 specific, actionable opportunities for ${monthName}
- 8-12 ready-to-publish post ideas (full captions + hashtags) tailored to the client's positioning
- 4-6 paid ad creative angles to test (channel, hook, offer)

Return everything via the competitor_analysis_report tool. Use ONLY the verified competitors above.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
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
      if (aiRes.status === 429) msg = "Rate limit hit. Please try again in a minute.";
      if (aiRes.status === 402) msg = "AI credits exhausted. Add credits in Settings → Workspace → Usage.";
      await sb.from("reports").update({ status: "error", error: msg }).eq("id", reportId);
      return new Response(JSON.stringify({ error: msg }), {
        status: aiRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await aiRes.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured output");
    }
    const parsed = JSON.parse(toolCall.function.arguments);

    await sb
      .from("reports")
      .update({ status: "complete", data: parsed, error: null })
      .eq("id", reportId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-competitors error", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    try {
      const { reportId } = await req.clone().json().catch(() => ({}));
      if (reportId) {
        const sb = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await sb.from("reports").update({ status: "error", error: msg }).eq("id", reportId);
      }
    } catch {}
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
