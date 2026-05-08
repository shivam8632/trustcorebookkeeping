document.addEventListener("DOMContentLoaded", () => {
  const checkoutButton = document.getElementById("checkout-button");
  const planSelect = document.getElementById("plan-select");
  const statusElement = document.getElementById("payment-status");

  if (!checkoutButton || !planSelect || !statusElement) {
    return;
  }

  let stripe;
  let isLoading = false;

  const setStatus = (message, isError = false) => {
    statusElement.textContent = message;
    statusElement.style.color = isError ? "#ff6b6b" : "var(--text-secondary)";
  };

  const setButtonState = (enabled) => {
    checkoutButton.disabled = !enabled;
    checkoutButton.style.opacity = enabled ? "1" : "0.6";
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
      setButtonState(true);
    } catch (error) {
      console.error("Payment config error:", error);
      setStatus(
        "Payment is currently unavailable. Please contact us directly.",
        true,
      );
      setButtonState(false);
    }
  };

  const startCheckout = async () => {
    if (!stripe || isLoading) {
      return;
    }

    const plan = planSelect.value;
    setButtonState(false);
    setStatus("Redirecting to secure payment...", false);
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
        err.message || "Payment could not be started. Please try again later.",
        true,
      );
      setButtonState(true);
    } finally {
      isLoading = false;
    }
  };

  checkoutButton.addEventListener("click", startCheckout);

  window.startStripeCheckout = async (plan) => {
    if (planSelect) {
      planSelect.value = plan;
    }
    if (!stripe) {
      await loadConfig();
    }
    await startCheckout();
  };

  setButtonState(false);
  loadConfig();
});
