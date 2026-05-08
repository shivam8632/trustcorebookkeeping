document.addEventListener("DOMContentLoaded", () => {
  const payPalContainer = document.getElementById("paypal-button-container");
  const payPalStatus = document.getElementById("paypal-status");
  const planSelect = document.getElementById("plan-select");

  if (!payPalContainer || !payPalStatus || !planSelect) {
    return;
  }

  const setPayPalStatus = (message, isError = false) => {
    payPalStatus.textContent = message;
    payPalStatus.style.color = isError ? "#ff6b6b" : "var(--text-secondary)";
  };

  const loadPayPalSDK = async (clientId) => {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(
        'script[src*="paypal.com/sdk/js"]',
      );
      if (existing) {
        return resolve(true);
      }

      const script = document.createElement("script");
      script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture`;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error("PayPal SDK failed to load."));
      document.head.appendChild(script);
    });
  };

  let selectedPayPalPlan = "Silver";

  const renderPayPalButton = () => {
    if (!window.paypal || !window.paypal.Buttons) {
      setPayPalStatus(
        "PayPal is unavailable. Please contact us directly.",
        true,
      );
      return;
    }

    window.paypal
      .Buttons({
        style: {
          layout: "vertical",
          color: "gold",
          shape: "rect",
          label: "paypal",
        },
        createOrder: async () => {
          setPayPalStatus("Preparing PayPal checkout...");
          selectedPayPalPlan = planSelect.value;

          const response = await fetch("/api/create-paypal-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan: selectedPayPalPlan }),
          });
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || "Unable to create PayPal order.");
          }

          return data.id;
        },
        onApprove: async (data) => {
          setPayPalStatus("Completing payment...");

          const response = await fetch("/api/capture-paypal-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderID: data.orderID }),
          });
          const result = await response.json();

          if (!response.ok || !result.success) {
            throw new Error(result.message || "Payment capture failed.");
          }

          window.location.href = `paypal-confirmation.html?status=success&orderID=${encodeURIComponent(
            data.orderID,
          )}&plan=${encodeURIComponent(selectedPayPalPlan)}`;
          return result;
        },
        onError: (err) => {
          console.error("PayPal button error:", err);
          setPayPalStatus(
            "PayPal checkout could not be completed. Please try again or contact us.",
            true,
          );
        },
        onCancel: () => {
          setPayPalStatus(
            "PayPal checkout was canceled. You can try again or choose another payment option.",
            true,
          );
        },
      })
      .render(payPalContainer);
  };

  const initPayPal = async () => {
    try {
      const response = await fetch("/paypal-config");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load PayPal configuration.");
      }

      await loadPayPalSDK(data.clientId);
      renderPayPalButton();
    } catch (error) {
      console.error("PayPal init error:", error);
      setPayPalStatus(
        "PayPal is not available right now. Contact us to pay by PayPal or other methods.",
        true,
      );
    }
  };

  initPayPal();
});
