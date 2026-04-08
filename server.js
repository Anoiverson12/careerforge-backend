// ============================================================
//  CareerForge AI — Backend Stripe (Node.js + Express)
//  Compatible : Vercel, Railway, Render, ou serveur classique
// ============================================================

const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

// ─── CORS ────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  methods: ["GET", "POST"],
}));

// ─── Body parser (RAW pour les webhooks Stripe) ───────────────
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// ============================================================
//  PLANS STRIPE
// ============================================================
const PLANS = {
  starter: {
    name: "Starter",
    priceId: process.env.STRIPE_PRICE_STARTER,
    amount: 0,
  },
  pro: {
    name: "Pro",
    priceId: process.env.STRIPE_PRICE_PRO,
    amount: 900,
  },
  agency: {
    name: "Agence",
    priceId: process.env.STRIPE_PRICE_AGENCY,
    amount: 4900,
  },
};

// ============================================================
//  1. CRÉER UNE SESSION DE PAIEMENT
// ============================================================
app.post("/create-checkout-session", async (req, res) => {
  const { plan, email } = req.body;

  if (!PLANS[plan]) {
    return res.status(400).json({ error: "Plan inconnu" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email || undefined,
      line_items: [{ price: PLANS[plan].priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing`,
      metadata: { plan },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  2. PORTAIL CLIENT
// ============================================================
app.post("/create-portal-session", async (req, res) => {
  const { customerId } = req.body;

  if (!customerId) {
    return res.status(400).json({ error: "customerId requis" });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Portal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  3. VÉRIFIER L'ABONNEMENT
// ============================================================
app.get("/subscription/:customerId", async (req, res) => {
  const { customerId } = req.params;

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return res.json({ active: false, plan: "starter" });
    }

    const sub = subscriptions.data[0];
    const priceId = sub.items.data[0].price.id;
    const planName = Object.keys(PLANS).find(
      (key) => PLANS[key].priceId === priceId
    ) || "unknown";

    res.json({
      active: true,
      plan: planName,
      subscriptionId: sub.id,
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
    });
  } catch (err) {
    console.error("Subscription check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  4. WEBHOOK STRIPE
// ============================================================
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      console.log("✅ Nouveau paiement:", {
        customer: session.customer,
        email: session.customer_email,
        plan: session.metadata.plan,
      });
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      console.log("🔄 Abonnement mis à jour:", sub.id, sub.status);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      console.log("❌ Abonnement annulé:", sub.id);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.log("💳 Paiement échoué pour:", invoice.customer_email);
      break;
    }
    default:
      console.log(`Événement non géré: ${event.type}`);
  }

  res.json({ received: true });
});

// ============================================================
//  5. HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── DÉMARRAGE ────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 CareerForge backend démarré sur le port ${PORT}`);
});

module.exports = app;
