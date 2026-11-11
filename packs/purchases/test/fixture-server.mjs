// A fake checkout for exercising `browser` offline: two origins, so the card field sits in a
// cross-origin (out-of-process) iframe like Stripe Elements. The card field only accepts
// trusted input, the iframe registers an imperative WebMCP tool and carries the Link Pay
// Token markers, and the page also exposes a declarative WebMCP form tool.
//
//   node fixture-server.mjs [shopPort] [cardPort]   then open http://127.0.0.1:<shopPort>/

import http from "node:http";

const shopPort = Number(process.argv[2] ?? 8471);
const cardPort = Number(process.argv[3] ?? 8472);
const cardOrigin = `http://localhost:${cardPort}`;
const orders = [];

const shop = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fixture Shop</title>
<h1>Fixture Shop</h1>
<p>Trail mug, $12.00 USD.</p>
<button id="add" onclick="document.getElementById('checkout').hidden=false;this.textContent='In cart'">Add to cart</button>
<section id="checkout" hidden>
  <h2>Checkout</h2>
  <label>Email <input id="email" name="email" type="email"></label>
  <label>Shipping speed <select id="speed"><option value="std">Standard</option><option value="fast">Express</option></select></label>
  <iframe id="card" title="Secure card payment input frame" src="${cardOrigin}/card" allow="tools" width="420" height="140"></iframe>
  <button id="pay" disabled>Pay $12.00</button>
  <p id="status"></p>
</section>
<h2>Agent checkout</h2>
<form id="agentform" action="/order" toolname="purchase" tooldescription="Buy the trail mug. Needs a card number, expiry (MM/YY) and a 2-letter country." toolautosubmit>
  <label>Card number <input name="card_number" required></label>
  <label>Expiry <input name="expiry" required></label>
  <label>Country <input name="country_code" required></label>
  <button>Place order</button>
</form>
<script>
let card = null;
addEventListener('message', (e) => {
  if (e.origin !== ${JSON.stringify(cardOrigin)}) return;
  card = e.data;
  document.getElementById('pay').disabled = !(card.trusted && card.complete);
});
document.getElementById('pay').onclick = async () => {
  const r = await fetch('/order', { method: 'POST', body: JSON.stringify({ via: 'page', email: document.getElementById('email').value, speed: document.getElementById('speed').value, last4: card.last4 }) });
  alert('Payment submitted');
  document.getElementById('status').textContent = (await r.json()).message;
};
const form = document.getElementById('agentform');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.agentInvoked) { document.getElementById('status').textContent = 'Use the WebMCP purchase tool.'; return; }
  event.respondWith((async () => {
    const data = Object.fromEntries(new FormData(form));
    const r = await fetch('/order', { method: 'POST', body: JSON.stringify({ via: 'webmcp', last4: data.card_number.slice(-4), country: data.country_code }) });
    return { status: 'confirmed', message: (await r.json()).message };
  })());
});
</script></html>`;

const cardFrame = `<!doctype html><html lang="en"><meta charset="utf-8"><title>card</title>
<label>Card number <input id="cardnumber" name="cardnumber" autocomplete="cc-number" inputmode="numeric"></label>
<p id="note">waiting</p>
<div class="AiAgentPaymentSteering" data-stripe-merchant-account="acct_fixture" style="position:absolute;left:-9999px">
  <input name="link_pay_token" aria-hidden="true">
</div>
<script>
const field = document.getElementById('cardnumber');
let trusted = true;
field.addEventListener('input', (e) => {
  // Like Stripe Elements: programmatic value changes are ignored.
  if (!e.isTrusted) { trusted = false; }
  const digits = field.value.replace(/\\D/g, '');
  document.getElementById('note').textContent = (e.isTrusted ? 'trusted' : 'untrusted') + ' input, ' + digits.length + ' digits';
  parent.postMessage({ trusted, complete: digits.length >= 15, last4: digits.slice(-4) }, '*');
});
document.querySelector('input[name=link_pay_token]').addEventListener('input', (e) => {
  document.getElementById('note').textContent = 'link pay token received (' + e.target.value.length + ' chars)';
});
if (document.modelContext && document.modelContext.registerTool) {
  document.modelContext.registerTool({
    name: 'get_link_pay_token_merchant',
    description: 'Get the merchant account identifier for Link Pay Token requests.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 'acct_fixture',
  });
}
</script></html>`;

function serve(port, routes) {
	http
		.createServer(async (req, res) => {
			if (req.method === "POST" && req.url === "/order") {
				let body = "";
				for await (const chunk of req) body += chunk;
				let order = {};
				try {
					order = JSON.parse(body);
				} catch {
					order = Object.fromEntries(new URLSearchParams(body));
				}
				orders.push(order);
				console.log(`order ${orders.length}: via ${order.via ?? "form"}, card ending ${order.last4 ?? "?"}`);
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ message: `Order ${orders.length} placed, card ending ${order.last4 ?? "?"}` }));
				return;
			}
			const page = routes[req.url ?? "/"];
			res.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
			res.end(page ?? "not found");
		})
		.listen(port, "127.0.0.1");
}

serve(shopPort, { "/": shop });
serve(cardPort, { "/card": cardFrame });
console.log(`fixture shop on http://127.0.0.1:${shopPort}/ (card frame from ${cardOrigin})`);
