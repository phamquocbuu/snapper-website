/**
 * Snapper pricing page - Paddle.js overlay checkout + live price totals.
 *
 * - All displayed amounts come straight from Paddle's PricePreview
 *   `formattedTotals.total`. No arithmetic, no re-formatting on this side.
 * - The environment, public client token, and price IDs are fetched from
 *   /api/checkout-context (a Pages Function). The secret Paddle API key is
 *   never exposed here.
 * - If anything fails, buy buttons are disabled and a notice is shown
 *   rather than letting a visitor click into a broken checkout.
 */
(function () {
  "use strict";

  var PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";

  // data-plan on each buy button -> key in the context `prices` object.
  var PLAN_TO_PRICE_KEY = { pro: "proFirst", lifetime: "lifetime" };

  var buyButtons = Array.prototype.slice.call(
    document.querySelectorAll(".js-buy"),
  );
  var noticeEl = document.querySelector("[data-checkout-notice]");

  function showNotice(message) {
    if (!noticeEl) return;
    noticeEl.textContent = message;
    noticeEl.hidden = false;
  }

  function disableBuyButtons() {
    buyButtons.forEach(function (btn) {
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("is-disabled");
    });
  }

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach(function (el) {
      el.textContent = value;
    });
  }

  function fatal(message) {
    disableBuyButtons();
    showNotice(message);
    // Restore the cached literal amounts so the page still reads sensibly.
    document.querySelectorAll("[data-fallback]").forEach(function (el) {
      el.textContent = el.getAttribute("data-fallback");
    });
  }

  function loadPaddleJs() {
    return new Promise(function (resolve, reject) {
      if (window.Paddle) return resolve();
      var s = document.createElement("script");
      s.src = PADDLE_JS;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("Could not load Paddle.js"));
      };
      document.head.appendChild(s);
    });
  }

  function fetchContext() {
    return fetch("/api/checkout-context", {
      headers: { Accept: "application/json" },
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          throw new Error(
            body && body.error ? body.error : "checkout-context failed",
          );
        }
        return body;
      });
    });
  }

  function priceItems(ctx) {
    return [
      { priceId: ctx.prices.proFirst, quantity: 1 },
      { priceId: ctx.prices.proRenewal, quantity: 1 },
      { priceId: ctx.prices.lifetime, quantity: 1 },
    ];
  }

  function renderTotals(ctx, preview) {
    var byId = {};
    preview.data.details.lineItems.forEach(function (li) {
      byId[li.price.id] = li.formattedTotals.total; // already localized by Paddle
    });

    var proFirst = byId[ctx.prices.proFirst];
    var proRenewal = byId[ctx.prices.proRenewal];
    var lifetime = byId[ctx.prices.lifetime];

    if (proFirst) {
      setText('[data-paddle-total="proFirst"]', proFirst);
      setText('[data-paddle-label="pro"]', "Buy Pro — " + proFirst);
    }
    if (proRenewal) {
      setText('[data-paddle-total="proRenewal"]', proRenewal);
    }
    if (lifetime) {
      setText('[data-paddle-total="lifetime"]', lifetime);
      setText('[data-paddle-label="lifetime"]', "Buy Lifetime — " + lifetime);
    }
  }

  function wireCheckout(ctx) {
    buyButtons.forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        if (btn.getAttribute("aria-disabled") === "true") return;

        var priceKey = PLAN_TO_PRICE_KEY[btn.getAttribute("data-plan")];
        var priceId = priceKey && ctx.prices[priceKey];
        if (!priceId) return;

        var options = {
          items: [{ priceId: priceId, quantity: 1 }],
          settings: {
            displayMode: "overlay",
            variant: "one-page",
            successUrl: new URL("/thanks", window.location.origin).href,
          },
        };
        if (ctx.customer) options.customer = ctx.customer;

        window.Paddle.Checkout.open(options);
      });
    });
  }

  function onPaddleEvent(event) {
    if (!event || !event.name) return;
    if (
      event.name === "checkout.error" ||
      event.name === "checkout.payment-error"
    ) {
      showNotice(
        "Something went wrong with checkout. Please try again, or email snapper@nexis.io.vn.",
      );
    }
  }

  function start() {
    if (buyButtons.length === 0) return;

    Promise.all([loadPaddleJs(), fetchContext()])
      .then(function (results) {
        var ctx = results[1];

        window.Paddle.Environment.set(ctx.environment);
        window.Paddle.Initialize({
          token: ctx.clientToken,
          eventCallback: onPaddleEvent,
        });

        wireCheckout(ctx);

        return window.Paddle.PricePreview({ items: priceItems(ctx) }).then(
          function (preview) {
            renderTotals(ctx, preview);
          },
        );
      })
      .catch(function (err) {
        // eslint-disable-next-line no-console
        console.error("[checkout]", err);
        fatal(
          "Live pricing is unavailable right now. Please try again shortly.",
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
