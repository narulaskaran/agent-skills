import assert from "node:assert/strict";
import { test } from "node:test";
import { cardFields, fillPlaceholders, hasPlaceholders, interactiveOnly, parseArgs, redact } from "../lib/browser.mjs";

// Stripe's public test card.
const TEST_CARD = ["4242", "4242", "4242", "4242"].join("");

test("redact hides Luhn-valid card numbers, spaced or not, and keeps the last four", () => {
	assert.equal(redact(`card ${TEST_CARD} ok`), "card [card •••• 4242] ok");
	assert.equal(redact(`"${TEST_CARD.replace(/(\d{4})(?=\d)/g, "$1 ")}"`), '"[card •••• 4242]"');
});

test("redact leaves order numbers, phone numbers and prices alone", () => {
	const text = "Order 1234567890123456 total $100.00, call +15551234567";
	assert.equal(redact(text), text);
});

test("redact blanks security-code fields in snapshots and known secrets anywhere", () => {
	assert.equal(redact('  - textbox "Security code" [ref=f1e9]: 123'), '  - textbox "Security code" [ref=f1e9]: [redacted]');
	assert.equal(redact('  - textbox "CVC" [active] [ref=f2e4]: "456"'), '  - textbox "CVC" [active] [ref=f2e4]: [redacted]');
	assert.equal(redact("token lpt_abcdefghijkl here", ["lpt_abcdefghijkl"]), "token [redacted] here");
	assert.equal(redact("token lpt_abcdefghijkl here", new Set(["lpt_abcdefghijkl"])), "token [redacted] here");
});

test("redact hides security codes read out of the page by eval or text", () => {
	assert.equal(redact("cardExpiry=12 / 34 | cardCvc=123 | zip=10001"), "cardExpiry=12 / 34 | cardCvc=[redacted] | zip=10001");
	assert.equal(redact('{"cvv": "4321"}'), '{"cvv": "[redacted]"}');
	assert.equal(redact("Security code 987"), "Security code [redacted]");
	assert.equal(redact("CVC is the 3-digit code on the back"), "CVC is the 3-digit code on the back");
});

test("card placeholders resolve from a Link card and fail loudly on unknown names", () => {
	const fields = cardFields({
		number: TEST_CARD,
		cvc: "123",
		exp_month: 4,
		exp_year: 2031,
		billing_address: { name: "Jane Doe", postal_code: "12345" },
	});
	assert.equal(fillPlaceholders("{{card.exp}}", fields), "04/31");
	assert.equal(fillPlaceholders("{{ card.exp_month }}/{{card.exp_year}}", fields), "04/2031");
	assert.equal(fillPlaceholders('{"n":"{{card.number}}","c":"{{card.cvc}}"}', fields), `{"n":"${TEST_CARD}","c":"123"}`);
	assert.equal(fillPlaceholders("{{card.name}} {{card.postal_code}}", fields), "Jane Doe 12345");
	assert.throws(() => fillPlaceholders("{{card.pin}}", fields), /unknown placeholder/);
	assert.equal(hasPlaceholders("plain text"), false);
	assert.equal(hasPlaceholders("{{card.number}}"), true);
});

test("parseArgs separates flags from positionals", () => {
	assert.deepEqual(parseArgs(["e5", "hello", "world", "--slow", "--spend-request", "lsrq_1"], ["slow"]), {
		positional: ["e5", "hello", "world"],
		flags: { slow: true, "spend-request": "lsrq_1" },
	});
	assert.deepEqual(parseArgs(["-i", "--max", "500"]), { positional: [], flags: { interactive: true, max: "500" } });
});

test("interactiveOnly keeps controls and headings", () => {
	const snapshot = ['- heading "Cart" [level=1] [ref=e1]', '- paragraph [ref=e2]: Free shipping', '- button "Checkout" [ref=e3]', "- iframe [ref=e4]:", '  - textbox "Card number" [ref=f1e2]'].join("\n");
	assert.equal(interactiveOnly(snapshot), ['- heading "Cart" [level=1] [ref=e1]', '- button "Checkout" [ref=e3]', "- iframe [ref=e4]:", '  - textbox "Card number" [ref=f1e2]'].join("\n"));
});
