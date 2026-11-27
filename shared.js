/* Ratchet site shell. Classic script; page scripts must use IIFEs.
   No instrument, no live-data polling — the ledger is the durable proof. */
var RatchetSite = (function () {
  var CHAIN = 44005;
  var CONTRACT = "0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36";
  var TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";
  var EXPLORER = "https://explorer-test.qday.info";
  var SITE = "https://tajudeeen.github.io/ratchet/";

  var NAV = [
    ["index", "index.html", "Entry"],
    ["tape", "audit-tape.html", "Audit tape"],
    ["how", "how-it-works.html", "How it works"],
    ["proof", "proof.html", "Source & proof"]
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
      '<div><h3>Ratchet</h3><p>One shared tUSD8 budget. Agent sessions that are capped, expiring and revocable — enforced on-chain, not in a prompt.</p><p class="mono">Aevum testnet · chain 44005</p></div>' +
      '<div><h3>Site</h3><a href="index.html">Entry</a><a href="audit-tape.html">Audit tape</a><a href="how-it-works.html">How it works</a><a href="proof.html">Source & proof</a></div>' +
      '<div><h3>Proof & source</h3><a href="https://github.com/Tajudeeen/ratchet">github.com/Tajudeeen/ratchet</a><a href="' + EXPLORER + '/address/' + CONTRACT + '">Contract on explorer</a><a href="https://dorahacks.io/hackathon/qday/detail">Aevum Builder Challenge #1</a></div>' +
      '</div><div class="foot-strip">Testnet only — no mainnet deployment, no production claim, no external audit. Aevum explorer source verification is unavailable upstream; identity is pinned by public repo + commit. The off-chain verifier is a convenience caller; all enforcement is on-chain.</div></div></footer>';
  }

  function mount(active) {
    var h = document.getElementById("site-header");
    var f = document.getElementById("site-footer");
    if (h) h.innerHTML = header(active);
    if (f) f.innerHTML = footer();
  }

  return { mount: mount, CHAIN: CHAIN, CONTRACT: CONTRACT, TUSD8: TUSD8, EXPLORER: EXPLORER, SITE: SITE };
})();
