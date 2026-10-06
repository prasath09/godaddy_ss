(function () {
  async function rpc(method, args) {
    const base = String(window.TEXTILE_API_BASE || "").replace(/\/+$/, "");

    if (!base) {
      throw new Error("TEXTILE_API_BASE is not configured.");
    }

    const response = await fetch(base + "/api/rpc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method,
        args,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "API error " + response.status);
    }

    return data.result;
  }

  function runner(successHandler, failureHandler) {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "withSuccessHandler") {
            return (fn) => runner(fn, failureHandler);
          }

          if (prop === "withFailureHandler") {
            return (fn) => runner(successHandler, fn);
          }

          if (prop === "then") {
            return undefined;
          }

          return (...args) => {
            rpc(String(prop), args)
              .then((result) => {
                if (typeof successHandler === "function") {
                  successHandler(result);
                }
              })
              .catch((error) => {
                if (typeof failureHandler === "function") {
                  failureHandler(error);
                } else {
                  console.error(error);
                }
              });
          };
        },
      },
    );
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};

  Object.defineProperty(window.google.script, "run", {
    configurable: true,
    get() {
      return runner(null, null);
    },
  });
})();
