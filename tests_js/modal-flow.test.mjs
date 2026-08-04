import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const membership = read('static/js/modules/membership.js');
const main = read('static/js/main.js');
const shell = read('static/js/modules/app-shell.js');
const pages = read('app/routes_pages.py');

assert.match(pages, /"payment-modal",\s*"admin-users-modal",/s);
assert.match(membership, /paymentModal\.classList\.remove\('hidden'\)/);
assert.doesNotMatch(membership, /window\.open\(/);
assert.match(main, /initAdminUsers\(dom\.adminUsersModal\)/);
assert.match(main, /_bind\(dom\.paymentPayBtn, 'click', confirmPayment\)/);
assert.doesNotMatch(main, /__navigateIfLeaving\('\/admin\/users'\)/);
assert.doesNotMatch(shell, /__navigateIfLeaving\('\/admin\/users'\)/);
assert.match(read('static/partials/payment-modal.html'), /id="payment-modal"/);
assert.match(read('static/partials/admin-users-modal.html'), /id="admin-users-modal"/);
assert.match(read('static/js/admin_users.js'), /export function initAdminUsers/);

console.log('modal flow contract: ok');
