// Initialize GSAP ScrollTrigger
gsap.registerPlugin(ScrollTrigger);

document.addEventListener("DOMContentLoaded", () => {
  // ── Header shrink on scroll ──────────────────────────────────────────────
  const header = document.querySelector(".header");
  window.addEventListener("scroll", () => {
    if (window.scrollY > 50) {
      header.style.padding = "0.5rem 0";
      header.style.boxShadow = "0 4px 30px rgba(0,0,0,0.5)";
    } else {
      header.style.padding = "1rem 0";
      header.style.boxShadow = "none";
    }
  });

  // ── Hero entrance ────────────────────────────────────────────────────────
  gsap.fromTo(
    ".gsap-reveal",
    { y: 60, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      duration: 1,
      stagger: 0.2,
      ease: "power3.out",
      delay: 0.3,
    },
  );

  // ── Scroll fade-up (play once only, no reverse) ──────────────────────────
  document.querySelectorAll(".gsap-fade-up").forEach((el) => {
    gsap.fromTo(
      el,
      { y: 40, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.9,
        ease: "power2.out",
        scrollTrigger: {
          trigger: el,
          start: "top 88%",
          toggleActions: "play none none none",
        },
      },
    );
  });

  // ── Process timeline slide-in ────────────────────────────────────────────
  document.querySelectorAll(".gsap-process").forEach((step, i) => {
    gsap.fromTo(
      step,
      { x: i % 2 === 0 ? -60 : 60, opacity: 0 },
      {
        x: 0,
        opacity: 1,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: step,
          start: "top 82%",
          toggleActions: "play none none none",
        },
      },
    );
  });

  // ── 3-D tilt on service cards ────────────────────────────────────────────
  document.querySelectorAll(".service-card").forEach((card) => {
    card.addEventListener("mouseenter", () => {
      card.style.transition = "none";
    });

    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const rx = ((e.clientY - r.top - r.height / 2) / (r.height / 2)) * -8;
      const ry = ((e.clientX - r.left - r.width / 2) / (r.width / 2)) * 8;
      card.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.02,1.02,1.02)`;
    });

    card.addEventListener("mouseleave", () => {
      card.style.transition = "transform 0.5s ease, box-shadow 0.3s ease";
      card.style.transform =
        "perspective(1000px) rotateX(0) rotateY(0) scale3d(1,1,1)";
    });
  });

  const planSelect = document.getElementById("plan-select");
  const checkoutSection = document.getElementById("checkout-section");

  document.querySelectorAll(".get-started-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = button.dataset.plan;
      if (planSelect) {
        planSelect.value = plan;
      }
      if (checkoutSection) {
        checkoutSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (window.startStripeCheckout) {
        window.startStripeCheckout(plan);
      }
    });
  });
});
