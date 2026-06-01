document.addEventListener("DOMContentLoaded", () => {
  const checkoutButton = document.getElementById("checkout-button");
  const planSelect = document.getElementById("plan-select");
  const statusElement = document.getElementById("payment-status");
  const achStatus = document.getElementById("ach-status");
  const achName = document.getElementById("ach-name");
  const achEmail = document.getElementById("ach-email");
  const achRouting = document.getElementById("ach-routing");
  const achAccount = document.getElementById("ach-account");
  const achManualButton = document.getElementById("ach-manual-button");
  const achSecureButton = document.getElementById("ach-secure-button");

  if (!checkoutButton || !planSelect || !statusElement || !achStatus) {
    return;
  }

  let stripe;
  let isLoading = false;

  const setStatus = (element, message, isError = false) => {
    element.textContent = message;
    element.style.color = isError ? "#ff6b6b" : "var(--text-secondary)";
  };

  const setButtonState = (button, enabled) => {
    if (!button) return;
    button.disabled = !enabled;
    button.style.opacity = enabled ? "1" : "0.6";
  };

  const loadConfig = async () => {
    try {
      const response = await fetch("/config");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Unable to load payment configuration.",
        );
      }

      stripe = Stripe(data.publishableKey);
      setButtonState(checkoutButton, true);
      setButtonState(achManualButton, true);
      setButtonState(achSecureButton, true);
    } catch (error) {
      console.error("Payment config error:", error);
      setStatus(
        statusElement,
        "Payment is currently unavailable. Please contact us directly.",
        true,
      );
      setButtonState(checkoutButton, false);
      setButtonState(achManualButton, false);
      setButtonState(achSecureButton, false);
    }
  };

  const startCheckout = async () => {
    if (!stripe || isLoading) {
      return;
    }

    const plan = planSelect.value;
    setButtonState(checkoutButton, false);
    setStatus(statusElement, "Redirecting to secure payment...", false);
    isLoading = true;

    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to create payment session.");
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      throw new Error("Invalid payment session response.");
    } catch (err) {
      console.error("Checkout error:", err);
      setStatus(
        statusElement,
        err.message || "Payment could not be started. Please try again later.",
        true,
      );
      setButtonState(checkoutButton, true);
    } finally {
      isLoading = false;
    }
  };

  const createACHPaymentIntent = async (payload) => {
    const response = await fetch("/api/create-ach-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  };

  const createACHConnectionSession = async (payload) => {
    const response = await fetch("/api/create-ach-connection-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  };

  const completeACHConnection = async (
    sessionId,
    paymentIntentId,
    name,
    email,
  ) => {
    setStatus(achStatus, "Completing secure bank connection...", false);
    try {
      const response = await fetch("/api/complete-ach-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, paymentIntentId, name, email }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to complete bank connection payment.",
        );
      }

      setStatus(
        achStatus,
        "ACH payment completed successfully. We will process your order shortly.",
        false,
      );
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      console.error("ACH connection error:", error);
      setStatus(
        achStatus,
        error.message ||
          "Secure ACH payment failed. Please try again or contact us.",
        true,
      );
    }
  };

  const startManualACH = async () => {
    if (!stripe || isLoading) {
      return;
    }

    const name = achName.value.trim();
    const email = achEmail.value.trim();
    const routingNumber = achRouting.value.trim();
    const accountNumber = achAccount.value.trim();
    const plan = planSelect.value;

    if (!name || !email || !routingNumber || !accountNumber) {
      setStatus(
        achStatus,
        "Please fill in your name, email, routing number, and account number.",
        true,
      );
      return;
    }

    setButtonState(achManualButton, false);
    setStatus(achStatus, "Processing ACH payment...", false);
    isLoading = true;

    try {
      const createResponse = await createACHPaymentIntent({
        plan,
        name,
        email,
      });

      if (!createResponse.clientSecret) {
        throw new Error(
          createResponse.message || "Unable to create ACH payment intent.",
        );
      }

      const { error, paymentIntent } = await stripe.confirmUsBankAccountPayment(
        createResponse.clientSecret,
        {
          payment_method: {
            type: "us_bank_account",
            us_bank_account: {
              routing_number: routingNumber,
              account_number: accountNumber,
              account_holder_type: "individual",
              account_holder_name: name,
            },
            billing_details: {
              name,
              email,
            },
          },
        },
      );

      if (error) {
        throw error;
      }

      if (
        paymentIntent &&
        ["processing", "succeeded"].includes(paymentIntent.status)
      ) {
        setStatus(
          achStatus,
          "ACH payment completed successfully. We will process your order shortly.",
          false,
        );
      } else {
        setStatus(
          achStatus,
          "ACH payment is pending verification. We will notify you when it is complete.",
          false,
        );
      }
    } catch (err) {
      console.error("Manual ACH error:", err);
      setStatus(
        achStatus,
        err.message ||
          "ACH payment failed. Please verify your details and try again.",
        true,
      );
    } finally {
      setButtonState(achManualButton, true);
      isLoading = false;
    }
  };

  const startSecureACH = async () => {
    if (!stripe || isLoading) {
      return;
    }

    const name = achName.value.trim();
    const email = achEmail.value.trim();
    const plan = planSelect.value;

    if (!name || !email) {
      setStatus(
        achStatus,
        "Enter your name and email to connect your bank securely.",
        true,
      );
      return;
    }

    setButtonState(achSecureButton, false);
    setStatus(achStatus, "Starting secure bank connection...", false);
    isLoading = true;

    try {
      const createResponse = await createACHConnectionSession({
        plan,
        name,
        email,
      });

      if (!createResponse.url) {
        throw new Error(
          createResponse.message || "Unable to start secure ACH connection.",
        );
      }

      window.location.href = createResponse.url;
    } catch (err) {
      console.error("Secure ACH error:", err);
      setStatus(
        achStatus,
        err.message || "Secure ACH connection failed. Please try again later.",
        true,
      );
      setButtonState(achSecureButton, true);
      isLoading = false;
    }
  };

  checkoutButton.addEventListener("click", startCheckout);
  achManualButton.addEventListener("click", startManualACH);
  achSecureButton.addEventListener("click", startSecureACH);

  window.startStripeCheckout = async (plan) => {
    if (planSelect) {
      planSelect.value = plan;
    }
    if (!stripe) {
      await loadConfig();
    }
    await startCheckout();
  };

  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("ach_session_id");
  const paymentIntentId = query.get("payment_intent_id");
  if (sessionId && paymentIntentId) {
    completeACHConnection(
      sessionId,
      paymentIntentId,
      achName.value.trim(),
      achEmail.value.trim(),
    );
  }

  setButtonState(checkoutButton, false);
  setButtonState(achManualButton, false);
  setButtonState(achSecureButton, false);
  loadConfig();
});
