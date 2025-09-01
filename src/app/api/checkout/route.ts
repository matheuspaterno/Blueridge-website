import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  try {
    const { tier } = await req.json();
    const priceId =
      tier === "starter" ? process.env.STRIPE_PRICE_STARTER :
      tier === "growth"  ? process.env.STRIPE_PRICE_GROWTH  : undefined;

    if (!priceId) return NextResponse.json({ error: "Unknown tier" }, { status: 400 });

    const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${site}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/checkout/cancel`,
      billing_address_collection: "auto",
      customer_creation: "if_required",
      subscription_data: {
        metadata: { tier },
      },
      metadata: { tier },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "checkout error" }, { status: 500 });
  }
}
