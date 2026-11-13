import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardFields, fillNumericPaymentField } from '../lib/browser.mjs';

function maskedField({ rejectPaste = false, alwaysClear = false } = {}) {
 let value = ''; const events = [];
 return {
  events,
  async click() {},
  async fill(next) { events.push(['fill', next]); value = rejectPaste ? '' : next; },
  async pressSequentially(next) { events.push(['keys', next]); value = next.replace(/\D/g, '').replace(/^(\d{2})(\d{2})$/, '$1 / $2'); },
  async press(key) { events.push(['press', key]); if (alwaysClear) value = ''; },
  async inputValue() { return value; },
 };
}

test('a hosted expiry mask that rejects paste receives digits as keystrokes, then is verified', async () => {
 const field = maskedField({ rejectPaste: true });
 assert.equal(await fillNumericPaymentField(field, '04/31'), undefined);
 assert.deepEqual(field.events.filter(event => event[0] === 'keys'), [['keys', '0431']]);
 assert.equal(await field.inputValue(), '04 / 31');
});

test('an accepted payment value is blurred and verified without a second fill', async () => {
 const field = maskedField();
 await fillNumericPaymentField(field, '04/31');
 assert.deepEqual(field.events, [['fill', '04/31'], ['press', 'Tab']]);
});

test('a field that clears on blur fails without returning secret data or submitting', async () => {
 const field = maskedField({ alwaysClear: true });
 await assert.rejects(fillNumericPaymentField(field, '04/31'), error => {
  assert.match(error.message, /stop before submitting payment/);
  assert.ok(!error.message.includes('04/31') && !error.message.includes('0431'));
  return true;
 });
 assert.ok(field.events.every(event => event[1] !== 'Enter'));
});

test('missing and malformed Link expiry metadata fails before any form is filled', () => {
 for (const card of [{}, { exp_month: 0, exp_year: 2031 }, { exp_month: 13, exp_year: 2031 }, { exp_month: 4, exp_year: '' }]) {
  assert.throws(() => cardFields(card), /missing or invalid expiry metadata/);
 }
});

import { numericFieldHolds } from '../lib/browser.mjs';

test('a hosted field that masks the number but shows the last four counts as holding it', () => {
 assert.equal(numericFieldHolds('•••• •••• •••• 0061', '4111111111110061').ok, true);
 assert.equal(numericFieldHolds('•••', '123').ok, true);
 assert.equal(numericFieldHolds('4111 1111 1111 0061', '4111111111110061').ok, true);
 assert.equal(numericFieldHolds('09 / 29', '0929').ok, true);
});

test('a masked field of the wrong length or with other trailing digits is rejected, without echoing the value', () => {
 assert.equal(numericFieldHolds('•••• •••• •••• 9999', '4111111111110061').ok, false);
 assert.equal(numericFieldHolds('•••• 0061', '4111111111110061').ok, false);
 assert.equal(numericFieldHolds('', '123').ok, false);
 assert.ok(!numericFieldHolds('•••• •••• •••• 9999', '4111111111110061').shape.includes('9999'));
});
