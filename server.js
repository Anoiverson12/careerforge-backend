// ============================================================
//  CareerForge AI — Backend FedaPay (Node.js + Express)
//  Adapté pour le Bénin — MTN MoMo & Mobile Money
// ============================================================

const express = require("express");
const cors = require("cors");
const https = require("https");

const app = express();

// ─── CORS ────────────────────────────────────────────────────
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
}));

app.use(express.json());

// ============================================================
//  PLANS
// ============================================================
const PLANS = {
  starter: { name: "Starter", amount: 0, currency: "XOF" },
  pro: { name: "Pro", amount: 5900, currency: "XOF" },
  agency: { name: "Agence", amount: 29000, currency: "XOF" },
};

// ============================================================
//  HELPER — Appel API FedaPay
// ============================================================
function fedapayRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.fedapay.com",
      port: 443,
      path: `/v1${path}`,
      method,
      headers: {
        "Authorization": `Bearer ${process.env.FEDAPAY_SECRET_KEY}`,
        "Content-Type": "application/json",
        ...(data && { "Content-Length": Buffer.byteLength(data) }),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => { responseData += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(responseData));
        } catch {
          reject(new Error("Réponse invalide de FedaPay"));
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ============================================================
//  1. CRÉER UNE TRANSACTION
// ============================================================
app.post("/create-checkout-session", async (req, res) => {
  const { plan, email, phone, firstname, lastname } = req.body;

  if (!PLANS[plan]) {
    return res.status(400).json({ error: "Plan inconnu" });
  }

  if (PLANS[plan].amount === 0) {
    return res.json({ free: true, message: "Plan gratuit activé" });
  }

  try {
    const transaction = await fedapayRequest("POST", "/transactions", {
      description: `CareerForge AI — Plan ${PLANS[plan].name}`,
      amount: PLANS[plan].amount,
      currency: { iso: PLANS[plan].currency },
      callback_url: `${process.env.FRONTEND_URL}/success`,
      customer: {
        email: email || "client@careerforge.com",
        phone_number: {
          number: phone || "",
          country: "BJ",
        },
        firstname: firstname || "Client",
        lastname: lastname || "CareerForge",
      },
    });

    const transactionId = transaction.v1?.transaction?.id
      || transaction.transaction?.id;

    const tokenData = await fedapayRequest(
      "GET",
      `/transactions/${transactionId}/token`,
      null
    );

    const paymentUrl = tokenData.url 
  || tokenData.token?.url
  || tokenData.token
  || tokenData.payment_url;

console.log("FedaPay tokenData:", JSON.stringify(tokenData));

if (!paymentUrl) {
  return res.status(500).json({ 
    error: "URL de paiement introuvable",
    debug: tokenData 
  });
}

res.json({ url: paymentUrl, transactionId });
  } catch (err) {
    console.error("FedaPay checkout error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  2. VÉRIFIER UNE TRANSACTION
// ============================================================
app.get("/transaction/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const data = await fedapayRequest("GET", `/transactions/${id}`, null);
    const transaction = data.v1?.transaction || data.transaction;

    if (!transaction) {
      return res.status(404).json({ error: "Transaction introuvable" });
    }

    res.json({
      id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      approved: transaction.status === "approved",
    });

  } catch (err) {
    console.error("Transaction check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  3. WEBHOOK FEDAPAY
// ============================================================
app.post("/webhook", async (req, res) => {
  const event = req.body;

  console.log("📩 Événement FedaPay reçu:", event.name);

  switch (event.name) {
    case "transaction.approved": {
      const transaction = event.entity;
      console.log("✅ Paiement approuvé:", {
        id: transaction.id,
        amount: transaction.amount,
        customer: transaction.customer?.email,
      });
      break;
    }
    case "transaction.declined": {
      console.log("❌ Paiement refusé:", event.entity?.id);
      break;
    }
    case "transaction.canceled": {
      console.log("🚫 Paiement annulé:", event.entity?.id);
      break;
    }
    default:
      console.log(`Événement non géré: ${event.name}`);
  }

  res.json({ received: true });
});

// ============================================================
//  4. HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    provider: "FedaPay",
    country: "Bénin",
    timestamp: new Date().toISOString(),
  });
});

// ─── DÉMARRAGE ────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 CareerForge backend FedaPay démarré sur le port ${PORT}`);
});

module.exports = app;
