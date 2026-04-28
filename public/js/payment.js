import {
  db,
  doc,
  addDoc,
  collection,
  serverTimestamp,
  updateDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
} from "./firebase-config.js";
import { getCurrentUser } from "./auth.js";

export async function initiatePayment(bankName, purpose, fieldsShared) {
  const user = getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const res = await fetch("/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 100, bankName, purpose }),
  });

  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to create order");

  return new Promise((resolve, reject) => {
    const options = {
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: "ClearKYC",
      description: `KYC Payment: ${bankName}`,
      order_id: data.orderId,
      config: {
        display: {
          hide: [
            {
              method: "upi",
              flows: ["collect"],
            },
          ],
        },
      },
      handler: async function (response) {
        try {
          const verifyRes = await fetch("/api/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });

          const verifyData = await verifyRes.json();
          if (!verifyData.success) {
            reject(new Error("Payment verification failed"));
            return;
          }

          await addDoc(collection(db, "users", user.uid, "accessLogs"), {
            bankName,
            purpose,
            fieldsShared,
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            amountEarned: 1,
            timestamp: serverTimestamp(),
          });

          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);
          const current = userSnap.data()?.totalEarnings || 0;
          await updateDoc(userRef, { totalEarnings: current + 1 });

          resolve({
            paymentId: response.razorpay_payment_id,
            bankName,
            amountEarned: 1,
          });
        } catch (err) {
          reject(err);
        }
      },
      prefill: {
        name: user.displayName || "",
        email: user.email || "",
      },
      theme: {
        color: "#0A2540",
      },
      modal: {
        ondismiss: function () {
          reject(new Error("Payment cancelled"));
        },
      },
    };

    const rzp = new Razorpay(options);
    rzp.open();
  });
}

export function listenToAccessLogs(callback) {
  const user = getCurrentUser();
  if (!user) return () => {};

  const q = query(
    collection(db, "users", user.uid, "accessLogs"),
    orderBy("timestamp", "desc")
  );

  return onSnapshot(q, (snapshot) => {
    const logs = [];
    snapshot.forEach((docSnap) => {
      logs.push({ id: docSnap.id, ...docSnap.data() });
    });
    callback(logs);
  });
}
