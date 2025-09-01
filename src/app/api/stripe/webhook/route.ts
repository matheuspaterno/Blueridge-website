import { NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const sig = req.headers.get("stripe-signature");
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  const buf = Buffer.from(await req.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig!, whSecret);
  } catch (err: any) {
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      console.log("checkout.session.completed", { id: s.id, customer: s.customer, subscription: s.subscription, metadata: s.metadata });
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const items = (sub.items?.data || []).map((i: Stripe.SubscriptionItem) => i.price.id);
      console.log("subscription event", { id: sub.id, status: sub.status, items, customer: sub.customer });
      break;
    }
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      console.log("invoice.paid", { id: inv.id, customer: inv.customer, status: inv.status });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
