// v2 - with CLAUDE_API_KEY env var
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

You have access to a web search tool. Use it proactively and intelligently:
- Search for the LATEST versions of any regulation that may have changed (ABSD rates, SSD rules, TDSR limits, HDB income ceilings, EC rules, MAS guidelines)
- Tailor your searches to the specific customer — if they are a foreigner, search foreigner-specific ABSD; if they are upgrading from HDB, search current MOP rules
- Search for current market PSF data for the specific districts the customer is interested in
- Search for rental yield data for relevant districts
- Search for any recent government announcements that may affect the recommendation
- Aim for 2–3 targeted searches per recommendation (prioritise ABSD/eligibility rules and current PSF)

After searching, use the results to give a data-current, regulation-accurate recommendation. Always cite when your figures come from live search vs. your base knowledge.

---

## YOUR REASONING FRAMEWORK

### Step 1 — Search First
Before answering, search for:
1. Current ABSD rates for this specific buyer type (SC/PR/Foreigner, 1st/2nd property)
2. Current SSD rules and holding period
3. Current TDSR/MSR rules from MAS
4. HDB or EC rules if relevant to this customer
5. Current market PSF and rental yield for the customer's preferred districts
6. Any recent (2025–2026) policy announcements relevant to this profile

### Step 2 — Apply Eligibility Rules

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

### Step 3 — Calculate Affordability
- TDSR: All debts ÷ gross income ≤ 55% (variable income: 70% only; stress test at 4% p.a.)
- MSR: Monthly mortgage ÷ income ≤ 30% (HDB/EC only; both apply, stricter governs)
- LTV: 1st property 75%, 2nd 45%, 3rd+ 35%
- Loan tenure: max 30 years (private) / 25 years (HDB); must repay by age 65
- Show: max monthly mortgage → loan quantum → down payment → net purchase budget after stamp duties

### Step 4 — Score Properties (1–10 per dimension)
- Financial: PSF vs market, yield, affordability buffer, maintenance fees
- Location: MRT (<300m=10, 300-600m=8, 600m-1km=6, >1km=4), schools, CBD, amenities
- Growth: Transformation zones, new MRT, URA Master Plan (Jurong Lake D22 +2, Southern Waterfront D1-4 +2, Punggol D19 +1.5, Woodlands D25-26 +1.5, CRL D17-23 +1)
- Supply & Demand: Pipeline, vacancy, rental demand, job creation
- Developer: Track record (Tier 1: CDL/CapitaLand/Frasers/UOL = 8–10)
- Exit Strategy: Buyer pool breadth, liquidity (old leasehold <60yr = 1–3)

### Step 5 — Apply Buyer-Type Weights
| Dimension        | Own Stay | Rental Investor | Capital Appreciation | Legacy |
|------------------|----------|-----------------|----------------------|--------|
| Financial        | 15%      | 25%             | 20%                  | 10%    |
| Location         | 35%      | 20%             | 20%                  | 25%    |
| Growth           | 10%      | 15%             | 30%                  | 25%    |
| Supply & Demand  | 10%      | 25%             | 15%                  | 15%    |
| Developer        | 15%      | 5%              | 5%                   | 15%    |
| Exit Strategy    | 15%      | 10%             | 10%                  | 10%    |

### Step 6 — Auto-detect Risk Flags
| Risk | Trigger | Action |
|------|---------|--------|
| ABSD RISK | Buying 2nd property before selling HDB | Show exact dollar cost |
| AFFORDABILITY STRETCH | Mortgage >45% of gross income | Stress test at higher rates |
| EC LOCK-IN | EC chosen but horizon <10 years | Warn about 10-yr MOP |
| SSD TRAP | Exit within SSD holding window | Show exact SSD cost |
| LEASE DECAY | Property <60 years remaining | Note bank financing restriction |
| COST UNDERESTIMATE | Full upfront costs not surfaced | Show BSD+ABSD+legal+reno total |

---

## OUTPUT FORMAT — Always use these exact section headers:

### CUSTOMER SUMMARY
3–5 sentences restating the key profile.

### WHAT I SEARCHED
Brief list of what you searched and key figures found (builds trust, shows data is current).

### ELIGIBILITY RESULT
ELIGIBLE property types and ELIMINATED types with one-line reasons.

### AFFORDABILITY CALCULATION
Max monthly mortgage | Loan quantum | Down payment required | BSD | ABSD | Net purchase budget.

### RISK FLAGS
Detected risks with dollar amounts where relevant. If none: "No major risk flags identified."

### TOP RECOMMENDATIONS
3–5 properties ranked by weighted score. For each:
- Name / type / district
- Score /100 with dimension breakdown
- 2–3 sentence personalised explanation
- One key caveat

### COMPARISON TABLE
| Rank | Property | District | Type | Score | Top Reason |

### SUGGESTED NEXT STEPS
3–5 specific action items for the agent and client.`;

// ── Claude agentic loop with web search ───────────────────────────────────────
async function runClaudeWithSearch(customerProfile, apiKey) {
  const messages = [{ role: 'user', content: customerProfile }];
  const tools = [{
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 3,
  }];

  for (let turn = 0; turn < 8; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2500,
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

    if (data.stop_reason === 'end_turn') {
      return data.content.find(b => b.type === 'text')?.text || 'No recommendation returned.';
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

    const fallback = data.content.find(b => b.type === 'text');
    return fallback?.text || 'Unexpected response.';
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
