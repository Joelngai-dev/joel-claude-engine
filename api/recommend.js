// v9 - fix: ultra-compact output so all 7 sections fit within 1700 tokens
/**
 * SG Property Recommendation Engine — Vercel Edge Function
 * Route: POST /api/recommend
 *
 * Environment variable required (Vercel → Project Settings → Environment Variables):
 *   CLAUDE_API_KEY = sk-ant-...
 */

export const config = { runtime: 'edge' };

// ── CORS Headers ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── System Prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a Singapore Property Recommendation Engine — an expert AI assistant that helps property agents recommend the right properties to their clients.

CRITICAL RULES:
1. Use web search to verify current ABSD rates and PSF prices. Do not write any text before searching.
2. After the search, IMMEDIATELY begin your report with "## CUSTOMER SUMMARY" — no intro, no acknowledgment, no "I'll help" text.
3. You MUST complete ALL 7 sections in order: CUSTOMER SUMMARY → ELIGIBILITY RESULT → AFFORDABILITY CALCULATION → RISK FLAGS → TOP RECOMMENDATIONS → SUGGESTED NEXT STEPS → COMPARISON TABLE. Every section is MANDATORY — do not stop early.
4. NEVER ask for more information. If any detail is missing, make a reasonable assumption.
5. Keep each section concise and structured — no repetition or padding.

---

## YOUR REASONING FRAMEWORK

### Step 1 — Apply Eligibility Rules

| Property Type         | SC        | PR                        | Foreigner                   |
|-----------------------|-----------|---------------------------|-----------------------------|
| HDB BTO               | Eligible  | Not eligible              | Not eligible                |
| HDB Resale            | Eligible  | After 3 years PR          | Not eligible                |
| EC (new launch)       | Eligible  | Not eligible              | Not eligible                |
| EC (after 10 years)   | Eligible  | Eligible (privatised)     | Eligible (privatised)       |
| Private Condo/Apt     | Eligible  | Eligible                  | Eligible                    |
| Landed (general)      | Eligible  | Requires LDAU approval    | Requires LDAU approval      |
| Landed (Sentosa Cove) | Eligible  | Eligible                  | Eligible (with approval)    |

HDB rules: At least one SC; income ceiling S$14,000/month (BTO); must not own private property; must not have disposed within 30 months.
EC rules (Post May 2026): Income ceiling S$16,000/month; at least one SC; 10-year MOP; 90% first-timer quota; no DPS.

### Step 2 — ABSD Rates (2023–2026 current)
| Buyer Type                        | 1st Property | 2nd Property | 3rd+ Property |
|-----------------------------------|-------------|-------------|--------------|
| Singapore Citizen (SC)            | 0%          | 20%         | 30%          |
| Singapore PR                      | 5%          | 30%         | 35%          |
| Foreigner (non-SPR)               | 60%         | 60%         | 60%          |
| Entity                            | 65%         | 65%         | 65%          |
| SC married to Foreigner (joint)   | 30% (remission available for 1st home if SC sole buyer) | — | — |

Note: ABSD remission available for married SC/PR couples buying first residential property together if they sell existing HDB within 6 months of private purchase.

### Step 3 — Buyer's Stamp Duty (BSD)
| Purchase Price Band   | Rate  |
|-----------------------|-------|
| First $180,000        | 1%    |
| Next $180,000         | 2%    |
| Next $640,000         | 3%    |
| Next $500,000         | 4%    |
| Next $1,500,000       | 5%    |
| Remainder above $3m   | 6%    |

### Step 4 — Calculate Affordability
- TDSR: All debts ÷ gross income ≤ 55% (stress test at 4% p.a.)
- MSR: Monthly mortgage ÷ income ≤ 30% (HDB/EC only; both apply, stricter governs)
- LTV: 1st property 75%, 2nd 45%, 3rd+ 35%
- Loan tenure: max 30 years (private) / 25 years (HDB); must repay by age 65
- Show: max monthly mortgage → loan quantum → down payment → net purchase budget after stamp duties

### Step 5 — Seller's Stamp Duty (SSD)
| Holding Period        | SSD Rate |
|-----------------------|----------|
| Up to 1 year          | 12%      |
| >1 to 2 years         | 8%       |
| >2 to 3 years         | 4%       |
| >3 years              | 0%       |

### Step 6 — Score Properties (1–10 per dimension)
- Financial: PSF vs market, yield, affordability buffer, maintenance fees
- Location: MRT (<300m=10, 300-600m=8, 600m-1km=6, >1km=4), schools, CBD, amenities
- Growth: Transformation zones, new MRT, URA Master Plan (Jurong Lake D22 +2, Southern Waterfront D1-4 +2, Punggol D19 +1.5, Woodlands D25-26 +1.5, CRL D17-23 +1)
- Supply & Demand: Pipeline, vacancy, rental demand, job creation
- Developer: Track record (Tier 1: CDL/CapitaLand/Frasers/UOL = 8–10)
- Exit Strategy: Buyer pool breadth, liquidity (old leasehold <60yr = 1–3)

### Step 7 — Apply Buyer-Type Weights
| Dimension        | Own Stay | Rental Investor | Capital Appreciation | Legacy |
|------------------|----------|-----------------|----------------------|--------|
| Financial        | 15%      | 25%             | 20%                  | 10%    |
| Location         | 35%      | 20%             | 20%                  | 25%    |
| Growth           | 10%      | 15%             | 30%                  | 25%    |
| Supply & Demand  | 10%      | 25%             | 15%                  | 15%    |
| Developer        | 15%      | 5%              | 5%                   | 15%    |
| Exit Strategy    | 15%      | 10%             | 10%                  | 10%    |

### Step 8 — Auto-detect Risk Flags
| Risk | Trigger | Action |
|------|---------|--------|
| ABSD RISK | Buying 2nd property before selling HDB | Show exact dollar cost |
| AFFORDABILITY STRETCH | Mortgage >45% of gross income | Stress test at higher rates |
| EC LOCK-IN | EC chosen but horizon <10 years | Warn about 10-yr MOP |
| SSD TRAP | Exit within SSD holding window | Show exact SSD cost |
| LEASE DECAY | Property <60 years remaining | Note bank financing restriction |
| COST UNDERESTIMATE | Full upfront costs not surfaced | Show BSD+ABSD+legal+reno total |

---

## OUTPUT FORMAT — Use EXACTLY these headers. Be ULTRA-CONCISE — every section must be short so all 7 fit.

### CUSTOMER SUMMARY
2 sentences only. Cover citizenship, income, budget, goal.

### ELIGIBILITY RESULT
3 lines max. Format: "✅ ELIGIBLE: [types]" then "❌ INELIGIBLE: [types + reason]"

### AFFORDABILITY CALCULATION
ONE line: "Max mortgage: $X/mo | Loan: $X | Down: $X | BSD: $X | ABSD: $X | Net budget: $X"

### RISK FLAGS
Max 2 flags. One line each: "⚠️ [FLAG]: [one-line impact]". If none: "No major risks."

### TOP RECOMMENDATIONS
3 properties. Each gets exactly 3 lines:
Line 1: **[Name/Type] | D[XX] | [Tenure]**
Line 2: Score [X]/100 — Financial:[X] Location:[X] Growth:[X] Supply:[X] Exit:[X]
Line 3: [One sentence reason + one caveat]

### SUGGESTED NEXT STEPS
2 bullet points only. Max 20 words each.

### COMPARISON TABLE
| Rank | Property | District | Score | Top Reason |
|------|----------|----------|-------|------------|
(3 data rows. Keep each cell short.)`;

// ── Claude agentic loop with 1 web search ─────────────────────────────────────
async function runClaudeWithSearch(customerProfile, apiKey) {
  const messages = [{ role: 'user', content: customerProfile }];
  const tools = [{
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 1,
  }];

  // Collect text from EVERY turn — Claude may write sections before AND after searching
  const allTextParts = [];

  for (let turn = 0; turn < 5; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1800,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Claude API ${res.status}`);
    }

    const data = await res.json();
    messages.push({ role: 'assistant', content: data.content });

    // Capture text from this turn regardless of stop_reason
    const turnTexts = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text.trim())
      .filter(Boolean);
    allTextParts.push(...turnTexts);

    if (data.stop_reason === 'end_turn') {
      return allTextParts.join('\n\n') || 'No recommendation returned.';
    }

    if (data.stop_reason === 'tool_use') {
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: b.content ?? [],
        }));
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Fallback
    return allTextParts.join('\n\n') || 'Unexpected response.';
  }

  throw new Error('Claude did not complete within expected turns.');
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });
  }

  try {
    const body = await request.json();
    const customerProfile = body.customer_profile;

    if (!customerProfile) {
      return new Response(JSON.stringify({ error: 'Missing customer_profile' }), { status: 400, headers: CORS });
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY not set in Vercel environment variables' }), { status: 500, headers: CORS });
    }

    const recommendation = await runClaudeWithSearch(customerProfile, apiKey);
    return new Response(JSON.stringify({ recommendation }), { status: 200, headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
