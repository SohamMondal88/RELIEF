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

const appt = (uid, extra = {}) => ({ userId: uid, status: 'pending', createdAt: serverTimestamp(), doctor: 'Dr A', ...extra });

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
  await assertFails(updateDoc(doc(alice(), ref.path), { status: 'confirmed' }));
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
