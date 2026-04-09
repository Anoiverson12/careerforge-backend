 const express = require("express");
const cors = require("cors");
const https = require("https");

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

const PLANS = {
  starter: { name: "Starter", amount: 0, currency: "XOF" },
  pro: { name: "Pro", amount: 5900, currency: "XOF" },
  agency: { name: "Agence", amount: 29000, currency: "XOF" },
};

function fedapayRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "sandbox-api.fedapay.com",
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
        try { resolve(JSON.parse(responseData)); }
        catch { reject(new Error("Réponse invalide")); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

app.post("/create-checkout-session", async (req, res) => {
  const { plan, email, phone, firstname, lastname } = req.body;

  if (!PLANS[plan]) return res.status(400).json({ error: "Plan inconnu" });
  if (PLANS[plan].amount === 0) return res.json({ free: true });

  try {
    // Étape 1 — Créer la transaction
    const txData = await fedapayRequest("POST", "/transactions", {
      description: `CareerForge AI — Plan ${PLANS[plan].name}`,
      amount: PLANS[plan].amount,
      currency: { iso: "XOF" },
      callback_url: `${process.env.FRONTEND_URL}/success`,
      customer: {
        email: email || "client@careerforge.com",
        phone_number: { number: phone || "97000000", country: "BJ" },
        firstname: firstname || "Client",
        lastname: lastname || "CareerForge",
      },
    });

    console.log("TX DATA:", JSON.stringify(txData));

    const transactionId = txData?.v1?.transaction?.id
      || txData?.transaction?.id
      || txData?.id;

    if (!transactionId) {
      return res.status(500).json({ error: "Transaction non créée", debug: txData });
    }

    // Étape 2 — Générer le token
    const tokenData = await fedapayRequest(
      "GET", `/transactions/${transactionId}/token`, null
    );

    console.log("TOKEN DATA:", JSON.stringify(tokenData));

    const paymentUrl = tokenData?.url
      || tokenData?.token?.url
      || tokenData?.v1?.token?.url
      || `https://sandbox-checkout.fedapay.com/pay/${tokenData?.token?.token}`;

    if (!paymentUrl) {
      return res.status(500).json({ error: "URL introuvable", debug: tokenData });
    }

    res.json({ url: paymentUrl, transactionId });

  } catch (err) {
    console.error("Erreur:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/transaction/:id", async (req, res) => {
  try {
    const data = await fedapayRequest("GET", `/transactions/${req.params.id}`, null);
    const tx = data?.v1?.transaction || data?.transaction || data;
    res.json({ id: tx?.id, status: tx?.status, approved: tx?.status === "approved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/webhook", (req, res) => {
  const event = req.body;
  console.log("Webhook:", event.name);
  res.json({ received: true });
});
app.get("/debug-fedapay", async (req, res) => {
  try {
    const txData = await fedapayRequest("POST", "/transactions", {
      description: "Test CareerForge",
      amount: 100,
      currency: { iso: "XOF" },
      callback_url: "https://careerforge-frontend.vercel.app/success",
      customer: {
        email: "test@test.com",
        phone_number: { number: "97000000", country: "BJ" },
        firstname: "Test",
        lastname: "User",
      },
    });
    res.json({ txData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/health", (req, res) => {
  res.json({ status: "ok", provider: "FedaPay", country: "Bénin", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend démarré sur ${PORT}`));
module.exports = app;
