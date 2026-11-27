/* Ratchet site shell + RPC helpers. Classic script; page scripts must use IIFEs. */
var RatchetSite = (function () {
  var RPC = "https://rpc-test.qday.info";
  var CHAIN = 44005;
  var CONTRACT = "0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36";
  var TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";
  var EXPLORER = "https://explorer-test.qday.info";

  var NAV = [
    ["index", "index.html", "Entry"],
    ["explorer", "explorer.html", "Explorer"],
    ["how", "how-it-works.html", "How it works"],
    ["proof", "proof.html", "Proof"]
  ];

  function header(active) {
    var links = NAV.map(function (n) {
      return '<a href="' + n[1] + '"' + (n[0] === active ? ' aria-current="page"' : "") + ">" + n[2] + "</a>";
    }).join("");
    return '<div class="site-header"><div class="wrap">' +
      '<a class="brand" href="index.html">Ratchet<span>scoped agent payments · aevum 44005</span></a>' +
      "<nav>" + links + "</nav></div></div>";
  }

  function footer() {
    return '<footer class="site-footer"><div class="wrap"><div class="foot-grid">' +
      '<div><h3>Ratchet</h3><p>One shared tUSD8 budget. Agent sessions that are capped, expiring and revocable — enforced on-chain.</p><p class="mono">Aevum testnet · chain 44005</p></div>' +
      '<div><h3>Site</h3><a href="index.html">Entry</a><a href="explorer.html">Live explorer</a><a href="how-it-works.html">How it works</a><a href="proof.html">Proof & evidence</a></div>' +
      '<div><h3>Source & proof</h3><a href="https://github.com/Tajudeeen/ratchet">github.com/Tajudeeen/ratchet</a><a href="' + EXPLORER + '/address/' + CONTRACT + '">Contract on explorer</a><a href="https://dorahacks.io/hackathon/qday/detail">Aevum Builder Challenge #1</a></div>' +
      '</div><div class="foot-strip">Testnet only — no mainnet deployment, no production claim. Explorer source verification is unavailable upstream; identity is pinned by public repo + commit. Off-chain verifier is a convenience caller; all enforcement is on-chain.</div></div></footer>';
  }

  function mount(active) {
    var h = document.getElementById("site-header");
    var f = document.getElementById("site-footer");
    if (h) h.innerHTML = header(active);
    if (f) f.innerHTML = footer();
  }

  var _id = 0;
  function rpc(method, params) {
    var body = JSON.stringify({ jsonrpc: "2.0", id: ++_id, method: method, params: params || [] });
    return fetch(RPC, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: body
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      if (j.error) throw new Error(j.error.message || "RPC error");
      return j.result;
    });
  }

  function hexToU32(hex) {
    if (!hex || hex.length < 10) return 0;
    // ABI-encoded uint256: read the low 32 bits (last 8 hex chars)
    return parseInt(hex.slice(-8), 16);
  }
  function u256(hex) {
    if (!hex || hex === "0x") return 0n;
    try { return BigInt(hex); } catch (e) { return 0n; }
  }
  function asAddr(word) {
    if (!word || word.length < 40) return "0x";
    return "0x" + word.slice(-40).toLowerCase();
  }
  function call(to, data) {
    return rpc("eth_call", [{ to: to, data: data }, "latest"]);
  }
  function short(h) {
    if (!h || h.length < 20) return h || "";
    return h.slice(0, 8) + "…" + h.slice(-5);
  }
  function tUSD(amount) { return (Number(amount) / 1e6).toFixed(2); }

  // selectors from committed ABI (solc 0.8.24)
  var SEL = {
    remainingBudget: "0x88177a23",
    token: "0xfc0c546a",
    owner: "0x8da5cb5b",
    balanceOf: "0x70a08231"
  };

  return {
    mount: mount, rpc: rpc, call: call, hexToU32: hexToU32, u256: u256,
    asAddr: asAddr, short: short, tUSD: tUSD, SEL: SEL,
    CHAIN: CHAIN, CONTRACT: CONTRACT, TUSD8: TUSD8, EXPLORER: EXPLORER, RPC: RPC
  };
})();
