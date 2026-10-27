/**
 * Firestore rules checks that run against the Firebase emulator.
 * Not picked up by `npm test` on purpose (needs Java and the emulator). Run:
 *
 *   cd firebase/emulator && npm install
 *   npm run check
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { serverTimestamp, doc, setDoc, getDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'relief-rules-test',
    firestore: { rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: '127.0.0.1', port: 8080 }
  });
});
after(async () => { await env.cleanup(); });

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

const appt = (uid, extra = {}) => ({ userId: uid, doctorId: 'doc-1', status: 'submitted', createdAt: serverTimestamp(), doctor: 'Dr A', ...extra });

test('users: owner can create and read own profile, others cannot', async () => {
  await assertSucceeds(setDoc(doc(alice(), 'users/alice'), { name: 'Alice', email: 'a@x.com', createdAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(alice(), 'users/alice')));
  await assertFails(getDoc(doc(bob(), 'users/alice')));
  await assertFails(getDoc(doc(anon(), 'users/alice')));
  await assertFails(setDoc(doc(bob(), 'users/alice'), { name: 'Evil' }));
});

test('users: cannot grant yourself privileged fields or store oversized data', async () => {
  await assertFails(setDoc(doc(alice(), 'users/alice'), { name: 'A', role: 'admin' }));
  await assertFails(setDoc(doc(alice(), 'users/alice'), { name: 'A', isAdmin: true }));
  await assertFails(setDoc(doc(alice(), 'users/alice'), { name: 'x'.repeat(101) }));
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => ['f' + i, i]));
  await assertFails(setDoc(doc(alice(), 'users/alice'), many));
});

test('appointments: valid create succeeds; forged owner/status/timestamp fails', async () => {
  await assertSucceeds(addDoc(collection(alice(), 'appointments'), appt('alice')));
  await assertFails(addDoc(collection(alice(), 'appointments'), appt('bob')));
  await assertFails(addDoc(collection(alice(), 'appointments'), appt('alice', { status: 'confirmed' })));
  await assertFails(addDoc(collection(alice(), 'appointments'), appt('alice', { createdAt: new Date('2020-01-01') })));
  await assertFails(addDoc(collection(anon(), 'appointments'), appt('alice')));
});

test('appointments: spam payloads are rejected', async () => {
  await assertFails(addDoc(collection(alice(), 'appointments'), appt('alice', { notes: 'x'.repeat(1001) })));
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['f' + i, i]));
  await assertFails(addDoc(collection(alice(), 'appointments'), appt('alice', many)));
});

test('appointments: owner reads own list, cannot read others, cannot edit status', async () => {
  const ref = await addDoc(collection(alice(), 'appointments'), appt('alice'));
  await assertSucceeds(getDocs(query(collection(alice(), 'appointments'), where('userId', '==', 'alice'))));
  await assertFails(getDocs(query(collection(bob(), 'appointments'), where('userId', '==', 'alice'))));
  await assertFails(getDocs(collection(alice(), 'appointments'))); // unfiltered list is not allowed
  await assertFails(updateDoc(doc(alice(), ref.path), { status: 'confirmed' }), 'a patient cannot confirm');
  await assertFails(deleteDoc(doc(bob(), ref.path)));
  await assertSucceeds(deleteDoc(doc(alice(), ref.path)));
});

test('emergencyRequests: valid create only, with server time and own userId', async () => {
  const good = { userId: 'alice', type: 'ambulance', data: { lat: 1 }, timestamp: serverTimestamp(), status: 'requested' };
  await assertSucceeds(addDoc(collection(alice(), 'emergencyRequests'), good));
  await assertFails(addDoc(collection(alice(), 'emergencyRequests'), { ...good, userId: 'bob' }));
  await assertFails(addDoc(collection(alice(), 'emergencyRequests'), { ...good, status: 'resolved' }));
  await assertFails(addDoc(collection(anon(), 'emergencyRequests'), good));
});

test('medicineDeliveries: valid create only', async () => {
  const good = { userId: 'alice', status: 'pending', createdAt: serverTimestamp(), items: ['x'] };
  await assertSucceeds(addDoc(collection(alice(), 'medicineDeliveries'), good));
  await assertFails(addDoc(collection(alice(), 'medicineDeliveries'), { ...good, status: 'delivered' }));
});

test('patients: owner only', async () => {
  await assertSucceeds(setDoc(doc(alice(), 'patients/alice'), { name: 'Alice', allergies: 'none' }, { merge: true }));
  await assertFails(getDoc(doc(bob(), 'patients/alice')));
  await assertFails(setDoc(doc(alice(), 'patients/alice'), { name: 'A', role: 'doctor' }, { merge: true }));
});

test('unknown collections are closed to everyone', async () => {
  await assertFails(setDoc(doc(alice(), 'secrets/1'), { a: 1 }));
  await assertFails(getDoc(doc(alice(), 'secrets/1')));
  await assertFails(getDoc(doc(anon(), 'anything/1')));
});

// ---------- appointment status transitions (Issue #62)

const provider = (id = 'doc-1') => env.authenticatedContext('prov-' + id, { providerId: id }).firestore();

async function seed(id, extra) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'appointments/' + id), Object.assign({
      userId: 'alice', doctorId: 'doc-1', status: 'submitted', createdAt: new Date('2026-10-01'), doctor: 'Dr A'
    }, extra));
  });
}

test('appointments: the request reference is the document id, so a repeated create is refused', async () => {
  await assertSucceeds(setDoc(doc(alice(), 'appointments/RQ-AAAA-BBBB'), appt('alice')));
  await assertFails(setDoc(doc(alice(), 'appointments/RQ-AAAA-BBBB'), appt('alice')), 'the second create is an update, which is not allowed');
});

test('appointments: new requests must start as submitted (not confirmed, not pending)', async () => {
  for (const status of ['confirmed', 'under_review', 'declined', 'cancelled', 'pending', 'requested']) {
    await assertFails(addDoc(collection(alice(), 'appointments'), appt('alice', { status })), status);
  }
});

test('appointments: a patient can cancel an open request, setting only status and the server time', async () => {
  for (const from of ['submitted', 'under_review', 'confirmed']) {
    await seed('cancel-' + from, { status: from });
    await assertSucceeds(updateDoc(doc(alice(), 'appointments/cancel-' + from), { status: 'cancelled', cancelledAt: serverTimestamp() }));
  }
});

test('appointments: a patient cannot do anything else to a request', async () => {
  await seed('p1');
  const ref = () => doc(alice(), 'appointments/p1');
  await assertFails(updateDoc(ref(), { status: 'confirmed' }), 'confirm');
  await assertFails(updateDoc(ref(), { status: 'under_review' }), 'review');
  await assertFails(updateDoc(ref(), { status: 'declined' }), 'decline');
  await assertFails(updateDoc(ref(), { status: 'cancelled', cancelledAt: new Date('2020-01-01') }), 'forged time');
  await assertFails(updateDoc(ref(), { status: 'cancelled' }), 'missing time');
  await assertFails(updateDoc(ref(), { status: 'cancelled', cancelledAt: serverTimestamp(), doctorId: 'doc-2' }), 'extra field');
  await assertFails(updateDoc(ref(), { status: 'cancelled', cancelledAt: serverTimestamp(), userId: 'bob' }), 'changing the owner');
  await assertFails(updateDoc(ref(), { notes: 'edited' }), 'editing');
  await assertFails(updateDoc(doc(bob(), 'appointments/p1'), { status: 'cancelled', cancelledAt: serverTimestamp() }), 'someone else cancelling');
  await assertFails(updateDoc(doc(anon(), 'appointments/p1'), { status: 'cancelled', cancelledAt: serverTimestamp() }), 'signed out');
});

test('appointments: declined and cancelled requests are final', async () => {
  for (const status of ['declined', 'cancelled']) {
    await seed('final-' + status, { status });
    await assertFails(updateDoc(doc(alice(), 'appointments/final-' + status), { status: 'cancelled', cancelledAt: serverTimestamp() }), 'patient from ' + status);
    for (const to of ['submitted', 'under_review', 'confirmed']) {
      await assertFails(updateDoc(doc(provider(), 'appointments/final-' + status), { status: to, statusUpdatedAt: serverTimestamp() }), 'provider ' + status + ' -> ' + to);
    }
  }
});

test('appointments: a provider moves a request only along the allowed path', async () => {
  const move = (id, to, db = provider()) => updateDoc(doc(db, 'appointments/' + id), { status: to, statusUpdatedAt: serverTimestamp() });

  await seed('v1', { status: 'submitted' });
  await assertFails(move('v1', 'confirmed'), 'submitted -> confirmed must go through review');
  await assertSucceeds(move('v1', 'under_review'));
  await assertSucceeds(move('v1', 'confirmed'));
  await assertFails(move('v1', 'declined'), 'confirmed -> declined');
  await assertFails(move('v1', 'submitted'), 'no going back');
  await assertSucceeds(move('v1', 'cancelled'));

  await seed('v2', { status: 'submitted' });
  await assertSucceeds(move('v2', 'declined'));

  await seed('v3', { status: 'under_review' });
  await assertSucceeds(move('v3', 'declined'));
});

test('appointments: a provider is limited to requests for their own id and to status fields', async () => {
  await seed('w1', { status: 'submitted' });
  const upd = (db, data) => updateDoc(doc(db, 'appointments/w1'), data);
  await assertFails(upd(provider('doc-2'), { status: 'under_review', statusUpdatedAt: serverTimestamp() }), 'another provider');
  await assertFails(upd(alice(), { status: 'under_review', statusUpdatedAt: serverTimestamp() }), 'a patient with no provider id');
  await assertFails(upd(provider(), { status: 'under_review' }), 'no server time');
  await assertFails(upd(provider(), { status: 'under_review', statusUpdatedAt: new Date('2020-01-01') }), 'forged time');
  await assertFails(upd(provider(), { status: 'under_review', statusUpdatedAt: serverTimestamp(), patientEmail: 'x@y.z' }), 'extra field');
  await assertSucceeds(getDoc(doc(provider(), 'appointments/w1')));
  await assertFails(getDoc(doc(provider('doc-2'), 'appointments/w1')), 'another provider cannot read');
  await assertFails(deleteDoc(doc(provider(), 'appointments/w1')), 'a provider cannot delete');
});
