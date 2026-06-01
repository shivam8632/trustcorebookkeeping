require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const Stripe = require("stripe");
const https = require("https");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML/CSS/JS files from the same folder
app.use(express.static(path.join(__dirname)));

// ── Rate limiter: max 10 form submissions per IP per 15 min ──────────────────
const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

// ── Nodemailer transporter ────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify transporter on startup
transporter.verify((err) => {
  if (err) {
    console.error("❌ Email transporter error:", err.message);
  } else {
    console.log("✅ Email transporter ready");
  }
});

// ── Helper: simple input sanitiser ───────────────────────────────────────────
function sanitise(str = "") {
  return String(str).trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const planPrices = {
  Silver: 27500,
  Gold: 55000,
  Platinum: 105000,
};

const PAYPAL_ENV = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
const PAYPAL_HOST =
  PAYPAL_ENV === "live" ? "api-m.paypal.com" : "api-m.sandbox.paypal.com";

function payPalRequest(path, method = "GET", body = null, authHeader = null) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json", "Accept-Language": "en_US" };
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    let rawBody;
    if (body) {
      if (typeof body === "string") {
        rawBody = body;
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else {
        rawBody = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
      }
      headers["Content-Length"] = Buffer.byteLength(rawBody, "utf8");
    }

    const options = {
      hostname: PAYPAL_HOST,
      path,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        try {
          const parsed = responseData ? JSON.parse(responseData) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(parsed);
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    });

    req.on("error", reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

async function createPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!clientId || !secret) {
    throw new Error("PayPal credentials are not configured.");
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  return payPalRequest(
    "/v1/oauth2/token",
    "POST",
    "grant_type=client_credentials",
    null,
    `Basic ${auth}`,
  ).then((data) => data.access_token);
}

// ── POST /api/contact  (General contact form) ─────────────────────────────────
app.post("/api/contact", formLimiter, async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({
      success: false,
      message: "Name, email, and message are required.",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address.",
    });
  }

  const sName = sanitise(name);
  const sEmail = sanitise(email);
  const sPhone = sanitise(phone);
  const sMessage = sanitise(message);

  const mailToOwner = {
    from: `"Trustcore Website" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    replyTo: sEmail,
    subject: `New Contact Inquiry from ${sName}`,
    html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#050b14;color:#fff;border-radius:12px;overflow:hidden;">
                <div style="background:#d4af37;padding:1.5rem 2rem;">
                    <h2 style="margin:0;color:#000;font-size:1.4rem;">📬 New Contact Inquiry</h2>
                </div>
                <div style="padding:2rem;">
                    <table style="width:100%;border-collapse:collapse;">
                        <tr><td style="padding:0.6rem 0;color:#a8b2d1;width:100px;">Name</td><td style="padding:0.6rem 0;color:#fff;font-weight:600;">${sName}</td></tr>
                        <tr><td style="padding:0.6rem 0;color:#a8b2d1;">Email</td><td style="padding:0.6rem 0;color:#fff;font-weight:600;"><a href="mailto:${sEmail}" style="color:#d4af37;">${sEmail}</a></td></tr>
                        ${sPhone ? `<tr><td style="padding:0.6rem 0;color:#a8b2d1;">Phone</td><td style="padding:0.6rem 0;color:#fff;font-weight:600;">${sPhone}</td></tr>` : ""}
                    </table>
                    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:1.5rem 0;">
                    <h3 style="color:#d4af37;margin-bottom:0.75rem;">Message</h3>
                    <p style="color:#a8b2d1;line-height:1.7;white-space:pre-wrap;">${sMessage}</p>
                </div>
                <div style="padding:1rem 2rem;background:rgba(255,255,255,0.04);text-align:center;font-size:0.8rem;color:#a8b2d1;">
                    Sent from trustcorebookkeeping.com contact form
                </div>
            </div>`,
  };

  const mailToClient = {
    from: `"Trustcore Bookkeeping" <${process.env.EMAIL_USER}>`,
    to: sEmail,
    subject: "We received your message — Trustcore Bookkeeping",
    html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#050b14;color:#fff;border-radius:12px;overflow:hidden;">
                <div style="background:#d4af37;padding:1.5rem 2rem;">
                    <h2 style="margin:0;color:#000;font-size:1.4rem;">✅ Message Received</h2>
                </div>
                <div style="padding:2rem;">
                    <p style="color:#fff;font-size:1.1rem;">Hi <strong>${sName}</strong>,</p>
                    <p style="color:#a8b2d1;line-height:1.7;">Thank you for reaching out to <strong style="color:#d4af37;">Trustcore Bookkeeping</strong>. We've received your message and will get back to you within <strong style="color:#fff;">1 business day</strong>.</p>
                    <p style="color:#a8b2d1;line-height:1.7;">In the meantime, feel free to call us directly at <a href="tel:+12066974413" style="color:#d4af37;">206 697 4413</a>.</p>
                    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:1.5rem 0;">
                    <p style="color:#a8b2d1;font-size:0.9rem;">— Tarandeep Singh, Trustcore Bookkeeping</p>
                </div>
            </div>`,
  };

  try {
    await transporter.sendMail(mailToOwner);
    await transporter.sendMail(mailToClient);
    return res.json({
      success: true,
      message:
        "Your message has been sent! We'll be in touch within 1 business day.",
    });
  } catch (err) {
    console.error("Contact email error:", err);
    return res.status(500).json({
      success: false,
      message:
        "Failed to send message. Please email us directly at trustcorebookkeeping@gmail.com",
    });
  }
});

// ── POST /api/inquiry  (Services "Get Started" form) ─────────────────────────
app.post("/api/inquiry", formLimiter, async (req, res) => {
  const { name, email, phone, plan, message } = req.body;

  if (!name || !email || !plan) {
    return res
      .status(400)
      .json({ success: false, message: "Name, email, and plan are required." });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address.",
    });
  }

  const sName = sanitise(name);
  const sEmail = sanitise(email);
  const sPhone = sanitise(phone);
  const sPlan = sanitise(plan);
  const sMessage = sanitise(message);

  const planPrices = {
    Silver: "$275/month",
    Gold: "$550/month",
    Platinum: "$1,050/month",
  };
  const planPrice = planPrices[sPlan] || "";

  const mailToOwner = {
    from: `"Trustcore Website" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    replyTo: sEmail,
    subject: `New ${sPlan} Plan Inquiry from ${sName}`,
    html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#050b14;color:#fff;border-radius:12px;overflow:hidden;">
                <div style="background:#d4af37;padding:1.5rem 2rem;">
                    <h2 style="margin:0;color:#000;font-size:1.4rem;">💼 New Plan Inquiry — ${sPlan} ${planPrice}</h2>
                </div>
                <div style="padding:2rem;">
                    <table style="width:100%;border-collapse:collapse;">
                        <tr><td style="padding:0.6rem 0;color:#a8b2d1;width:100px;">Name</td><td style="padding:0.6rem 0;color:#fff;font-weight:600;">${sName}</td></tr>
                        <tr><td style="padding:0.6rem 0;color:#a8b2d1;">Email</td><td style="padding:0.6rem 0;color:#fff;font-weight:600;"><a href="mailto:${sEmail}" style="color:#d4af37;">${sEmail}</a></td></tr>
                        ${sPhone ? `<tr><td style="padding:0.6rem 0;color:#a8b2d1;">Phone</td><td style="padding:0.6rem 0;color:#fff;font-weight:600;">${sPhone}</td></tr>` : ""}
                        <tr><td style="padding:0.6rem 0;color:#a8b2d1;">Plan</td><td style="padding:0.6rem 0;"><span style="background:#d4af37;color:#000;padding:0.2rem 0.8rem;border-radius:50px;font-weight:700;font-size:0.9rem;">${sPlan} — ${planPrice}</span></td></tr>
                    </table>
                    ${
                      sMessage
                        ? `
                    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:1.5rem 0;">
                    <h3 style="color:#d4af37;margin-bottom:0.75rem;">Additional Notes</h3>
                    <p style="color:#a8b2d1;line-height:1.7;white-space:pre-wrap;">${sMessage}</p>`
                        : ""
                    }
                </div>
                <div style="padding:1rem 2rem;background:rgba(255,255,255,0.04);text-align:center;font-size:0.8rem;color:#a8b2d1;">
                    Sent from trustcorebookkeeping.com services page
                </div>
            </div>`,
  };

  const mailToClient = {
    from: `"Trustcore Bookkeeping" <${process.env.EMAIL_USER}>`,
    to: sEmail,
    subject: `Your ${sPlan} Plan Inquiry — Trustcore Bookkeeping`,
    html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#050b14;color:#fff;border-radius:12px;overflow:hidden;">
                <div style="background:#d4af37;padding:1.5rem 2rem;">
                    <h2 style="margin:0;color:#000;font-size:1.4rem;">✅ Inquiry Received</h2>
                </div>
                <div style="padding:2rem;">
                    <p style="color:#fff;font-size:1.1rem;">Hi <strong>${sName}</strong>,</p>
                    <p style="color:#a8b2d1;line-height:1.7;">Thank you for your interest in the <strong style="color:#d4af37;">${sPlan} Plan (${planPrice})</strong>. We've received your inquiry and Tarandeep will reach out within <strong style="color:#fff;">1 business day</strong> to discuss your bookkeeping needs.</p>
                    <p style="color:#a8b2d1;line-height:1.7;">For immediate assistance, call us at <a href="tel:+12066974413" style="color:#d4af37;">206 697 4413</a>.</p>
                    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:1.5rem 0;">
                    <p style="color:#a8b2d1;font-size:0.9rem;">— Tarandeep Singh, Trustcore Bookkeeping</p>
                </div>
            </div>`,
  };

  try {
    await transporter.sendMail(mailToOwner);
    await transporter.sendMail(mailToClient);
    return res.json({
      success: true,
      message: `Thank you! We'll reach out about your ${sPlan} plan within 1 business day.`,
    });
  } catch (err) {
    console.error("Inquiry email error:", err);
    return res.status(500).json({
      success: false,
      message:
        "Failed to send inquiry. Please email us directly at trustcorebookkeeping@gmail.com",
    });
  }
});

// ── Stripe checkout configuration endpoint ─────────────────────────────────
app.get("/config", (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY || !stripe) {
    return res.status(500).json({
      success: false,
      message:
        "Stripe is not configured. Set STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY.",
    });
  }
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    plans: {
      Silver: "$275 / month",
      Gold: "$550 / month",
      Platinum: "$1,050 / month",
    },
  });
});

app.post("/api/create-checkout-session", formLimiter, async (req, res) => {
  const { plan } = req.body;
  if (!plan || !planPrices[plan]) {
    return res
      .status(400)
      .json({ success: false, message: "Please select a valid plan." });
  }
  if (!stripe) {
    return res.status(500).json({
      success: false,
      message: "Payment processor is not configured.",
    });
  }

  const YOUR_DOMAIN = `${req.protocol}://${req.get("host")}`;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Trustcore Bookkeeping ${plan} Plan`,
            },
            unit_amount: planPrices[plan],
          },
          quantity: 1,
        },
      ],
      metadata: { plan },
      success_url: `${YOUR_DOMAIN}/services.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${YOUR_DOMAIN}/services.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    res.status(500).json({
      success: false,
      message: "Unable to create Stripe checkout session.",
    });
  }
});

app.get("/paypal-config", (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET) {
    return res.status(500).json({
      success: false,
      message: "PayPal credentials are not configured.",
    });
  }

  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID,
    env: PAYPAL_ENV,
  });
});

app.post("/api/create-paypal-order", formLimiter, async (req, res) => {
  const { plan } = req.body;
  if (!plan || !planPrices[plan]) {
    return res
      .status(400)
      .json({ success: false, message: "Please select a valid plan." });
  }

  try {
    const accessToken = await createPayPalAccessToken();
    const order = await payPalRequest(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: (planPrices[plan] / 100).toFixed(2),
            },
            description: `Trustcore Bookkeeping ${plan} Plan`,
          },
        ],
        application_context: {
          brand_name: "Trustcore Bookkeeping",
          landing_page: "BILLING",
          user_action: "PAY_NOW",
          return_url: `${req.protocol}://${req.get("host")}/services.html`,
          cancel_url: `${req.protocol}://${req.get("host")}/services.html`,
        },
      },
      accessToken,
    );

    res.json({ id: order.id });
  } catch (err) {
    console.error("PayPal order creation error:", err);
    res
      .status(500)
      .json({ success: false, message: "Unable to create PayPal order." });
  }
});

app.post("/api/capture-paypal-order", formLimiter, async (req, res) => {
  const { orderID } = req.body;
  if (!orderID) {
    return res
      .status(400)
      .json({ success: false, message: "Order ID is required." });
  }

  try {
    const accessToken = await createPayPalAccessToken();
    const capture = await payPalRequest(
      `/v2/checkout/orders/${orderID}/capture`,
      "POST",
      null,
      accessToken,
    );
    res.json({ success: true, capture });
  } catch (err) {
    console.error("PayPal capture error:", err);
    res
      .status(500)
      .json({ success: false, message: "Unable to capture PayPal order." });
  }
});

app.post("/api/create-ach-payment-intent", formLimiter, async (req, res) => {
  const { plan, name, email } = req.body;
  if (!plan || !planPrices[plan] || !name || !email) {
    return res
      .status(400)
      .json({ success: false, message: "Plan, name, and email are required." });
  }

  if (!stripe) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Payment processor is not configured.",
      });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: planPrices[plan],
      currency: "usd",
      payment_method_types: ["us_bank_account"],
      metadata: { plan, name, email },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("ACH payment intent error:", err);
    res
      .status(500)
      .json({
        success: false,
        message: "Unable to create ACH payment intent.",
      });
  }
});

app.post(
  "/api/create-ach-connection-session",
  formLimiter,
  async (req, res) => {
    const { plan, name, email } = req.body;
    if (!plan || !planPrices[plan] || !name || !email) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Plan, name, and email are required.",
        });
    }

    if (!stripe) {
      return res
        .status(500)
        .json({
          success: false,
          message: "Payment processor is not configured.",
        });
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: planPrices[plan],
        currency: "usd",
        payment_method_types: ["us_bank_account"],
        payment_method_options: {
          us_bank_account: {
            financial_connections: {
              permissions: ["payment_method"],
            },
          },
        },
        metadata: { plan, name, email },
      });

      const YOUR_DOMAIN = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.financialConnections.sessions.create({
        account_holder: { type: "individual", email },
        permissions: ["payment_method"],
        return_url: `${YOUR_DOMAIN}/services.html?ach_session_id={SESSION_ID}&payment_intent_id=${paymentIntent.id}`,
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error("ACH connection session error:", err);
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to create secure bank connection.",
        });
    }
  },
);

app.post("/api/complete-ach-connection", formLimiter, async (req, res) => {
  const { sessionId, paymentIntentId, name, email } = req.body;
  if (!sessionId || !paymentIntentId || !name || !email) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Session ID, payment intent ID, name, and email are required.",
      });
  }

  if (!stripe) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Payment processor is not configured.",
      });
  }

  try {
    const session = await stripe.financialConnections.sessions.retrieve(
      sessionId,
      {
        expand: ["accounts"],
      },
    );
    const connectedAccount = session.accounts?.data?.[0];

    if (!connectedAccount) {
      return res
        .status(400)
        .json({
          success: false,
          message: "No connected bank account was returned.",
        });
    }

    const paymentMethod = await stripe.paymentMethods.create({
      type: "us_bank_account",
      us_bank_account: {
        financial_connections_account: connectedAccount.id,
      },
      billing_details: {
        name,
        email,
      },
    });

    const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethod.id,
    });

    res.json({ success: true, status: paymentIntent.status });
  } catch (err) {
    console.error("Complete ACH connection error:", err);
    res
      .status(500)
      .json({ success: false, message: "Unable to complete ACH payment." });
  }
});

// ── Catch-all: serve index.html for any unmatched route ─────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(
    `\n🚀 Trustcore Bookkeeping server running at http://localhost:${PORT}`,
  );
  console.log(`   Press Ctrl+C to stop\n`);
});
