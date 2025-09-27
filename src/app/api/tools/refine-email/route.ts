import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

/**
 * POST /api/tools/refine-email
 * Body: { raw: string, name?: string }
 * Returns: { email: string | null, reason?: string }
 * Uses a lightweight model to extract the most plausible email from a noisy / narrated string.
 */
export async function POST(req: NextRequest) {
  try {
    const { raw, name, letters } = await req.json();
    if (!raw || typeof raw !== 'string') {
      return NextResponse.json({ email: null, reason: 'No raw string provided' }, { status: 400 });
    }
  const lettersLine = Array.isArray(letters) && letters.length ? `Spelled letters sequence (chronological, may include duplicates or misses): ${letters.join(' ')}` : 'Spelled letters sequence: (none provided)';
  const prompt = `Extract ONLY the valid email address from the following noisy spoken style input.
If there is clearly narration glued to the front (e.g. yesmynameis / myemailis / nameis / emailis / thisis / its) or repeated user name segments, strip them.
If multiple plausible locals appear that all end with the same domain, prefer the one that matches a normal looking local part comprised of letters/digits plus optional dots or underscores, and that includes the provided name if it appears as a contiguous subsequence.
If the raw local part shows concatenated duplicated chunks (e.g. mateosmatheus, matheusmateus) prefer the longest coherent single occurrence that aligns with spelled letters sequence order.
Return just the cleaned email or the word NONE if you are not at least 95% confident:

Name (may be empty): ${name || 'UNKNOWN'}
Raw: ${raw}
${lettersLine}

Answer:`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_REFINER_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: 'You output ONLY the email or NONE. No extra words.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 40
    });

    const text = completion.choices?.[0]?.message?.content?.trim() || '';
    let email: string | null = null;
    if (/^none$/i.test(text)) email = null; else {
      const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (match) email = match[0].toLowerCase();
    }
    return NextResponse.json({ email });
  } catch (e: any) {
    return NextResponse.json({ email: null, reason: e?.message || 'error' }, { status: 500 });
  }
}
