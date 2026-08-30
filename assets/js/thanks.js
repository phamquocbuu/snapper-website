/**
 * /thanks — show the buyer their license key inline.
 *
 * Paddle appends `?_ptxn=<transaction id>` to the checkout success URL.
 * We hand that to /api/license-lookup, which verifies the transaction
 * with Paddle before returning the key. If the webhook has not written
 * the row yet (202) we retry a few times, then fall back to "check your
 * email".
 */
(function () {
  "use strict";

  var txn = new URLSearchParams(window.location.search).get("_ptxn");
  if (!txn) return; // Direct visit, no transaction — leave the default copy.

  var box = document.getElementById("license-box");
  var views = {
    idle: document.getElementById("license-idle"),
    loading: document.getElementById("license-loading"),
    ready: document.getElementById("license-ready"),
    pending: document.getElementById("license-pending"),
    error: document.getElementById("license-error"),
  };

  function show(state) {
    Object.keys(views).forEach(function (k) {
      if (views[k]) views[k].hidden = k !== state;
    });
    if (box) box.setAttribute("data-state", state);
  }

  var MAX_TRIES = 4;

  function attempt(tries) {
    show("loading");
    fetch("/api/license-lookup?txn=" + encodeURIComponent(txn))
      .then(function (res) {
        return res.json().then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (r) {
        if (r.status === 200 && r.body.key) {
          document.getElementById("license-key").textContent = r.body.key;
          document.getElementById("license-band").textContent =
            "Updates through " + r.body.entitled_versions;
          show("ready");
          return;
        }
        if (r.status === 202 && tries < MAX_TRIES) {
          setTimeout(function () {
            attempt(tries + 1);
          }, 3000);
          show("pending");
          return;
        }
        if (r.status === 202) {
          show("pending");
          return;
        }
        show("error");
      })
      .catch(function () {
        show("error");
      });
  }

  attempt(1);
})();
