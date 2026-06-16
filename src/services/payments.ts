import { OAuth2Client } from "google-auth-library";
import { Payment } from "../models/Payment";
import { ConsultationRequest } from "../models/ConsultationRequest";
import { activateConsultationAfterPayment } from "./consultationMatching";
import { logConsultationEvent } from "./consultationEvents";
import { CONSULT_FEE_NPR } from "../types";

const ESEWA_VERIFY_URL =
  process.env.ESEWA_VERIFY_URL ?? "https://uat.esewa.com.np/api/epay/transaction/status/";

export function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:4000/api/auth/google/callback";

  if (!clientId || !clientSecret) {
    return null;
  }

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function getGoogleAuthUrl() {
  const client = getGoogleClient();
  if (!client) return null;

  return client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    state: "user",
  });
}

export async function exchangeGoogleCode(code: string) {
  const client = getGoogleClient();
  if (!client) throw new Error("Google OAuth not configured");

  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error("No id_token from Google");

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error("Google account missing email");

  return {
    googleId: payload.sub!,
    email: payload.email,
    name: payload.name ?? payload.email.split("@")[0],
    avatarUrl: payload.picture,
  };
}

export async function initPayment(
  requestId: string,
  userId: string,
  provider: "esewa" | "khalti"
) {
  const request = await ConsultationRequest.findOne({ _id: requestId, userId });
  if (!request) throw new Error("Consultation not found");
  if (request.status !== "payment_pending") {
    throw new Error("Consultation is not awaiting payment");
  }

  const payment = await Payment.create({
    requestId: request._id,
    userId: request.userId,
    provider,
    amountNpr: CONSULT_FEE_NPR,
    status: "pending",
  });

  request.paymentId = payment._id;
  await request.save();

  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const productCode = process.env.ESEWA_PRODUCT_CODE ?? "EPAYTEST";
  const khaltiKey = process.env.KHALTI_SECRET_KEY ?? "test_secret_key";

  if (provider === "esewa") {
    const params = new URLSearchParams({
      amt: String(CONSULT_FEE_NPR),
      psc: "0",
      pdc: "0",
      txAmt: "0",
      tAmt: String(CONSULT_FEE_NPR),
      pid: payment._id.toString(),
      scd: productCode,
      su: `${frontendUrl}/consult/payment/esewa/success`,
      fu: `${frontendUrl}/consult/payment/esewa/failure`,
    });
    return {
      payment: payment,
      redirectUrl: `https://uat.esewa.com.np/epay/main?${params.toString()}`,
    };
  }

  return {
    payment,
    redirectUrl: null,
    khalti: {
      publicKey: process.env.KHALTI_PUBLIC_KEY ?? "test_public_key_dc74e0fd57cb46c19d64e33b256af0",
      amount: CONSULT_FEE_NPR * 100,
      productIdentity: payment._id.toString(),
      productName: "Legal Consultation (15 min)",
      productUrl: `${frontendUrl}/consult`,
      returnUrl: `${frontendUrl}/consult/payment/khalti/verify?paymentId=${payment._id}`,
    },
  };
}

export async function verifyEsewaPayment(
  paymentId: string,
  refId: string,
  amt: string
) {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.provider !== "esewa") {
    throw new Error("Payment not found");
  }
  if (payment.status === "paid") return payment;

  const productCode = process.env.ESEWA_PRODUCT_CODE ?? "EPAYTEST";
  const url = `${ESEWA_VERIFY_URL}?product_code=${productCode}&total_amount=${amt}&transaction_uuid=${paymentId}`;

  let verified = false;
  try {
    const res = await fetch(url);
    const data = (await res.json()) as { status?: string };
    verified = data.status === "COMPLETE";
  } catch {
    if (process.env.NODE_ENV !== "production" && refId) {
      verified = true;
    }
  }

  if (!verified) {
    payment.status = "failed";
    payment.providerRef = refId;
    await payment.save();
    await logConsultationEvent(payment.requestId, "payment_failed", "system", undefined, {
      provider: "esewa",
      refId,
    });
    throw new Error("Payment verification failed");
  }

  payment.status = "paid";
  payment.providerRef = refId;
  payment.paidAt = new Date();
  await payment.save();

  await logConsultationEvent(payment.requestId, "payment_paid", "system", undefined, {
    provider: "esewa",
    refId,
  });

  await activateConsultationAfterPayment(payment.requestId.toString());
  return payment;
}

export async function verifyKhaltiPayment(paymentId: string, token: string) {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.provider !== "khalti") {
    throw new Error("Payment not found");
  }
  if (payment.status === "paid") return payment;

  const secretKey = process.env.KHALTI_SECRET_KEY ?? "test_secret_key";

  let verified = false;
  let idx: string | undefined;

  try {
    const res = await fetch("https://khalti.com/api/v2/payment/verify/", {
      method: "POST",
      headers: {
        Authorization: `Key ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token, amount: CONSULT_FEE_NPR * 100 }),
    });
    const data = (await res.json()) as { idx?: string; state?: { name?: string } };
    verified = data.state?.name === "Completed" || Boolean(data.idx);
    idx = data.idx;
    payment.rawResponse = data as Record<string, unknown>;
  } catch {
    if (process.env.NODE_ENV !== "production" && token) {
      verified = true;
      idx = token;
    }
  }

  if (!verified) {
    payment.status = "failed";
    await payment.save();
    await logConsultationEvent(payment.requestId, "payment_failed", "system", undefined, {
      provider: "khalti",
    });
    throw new Error("Payment verification failed");
  }

  payment.status = "paid";
  payment.providerRef = idx;
  payment.paidAt = new Date();
  await payment.save();

  await logConsultationEvent(payment.requestId, "payment_paid", "system", undefined, {
    provider: "khalti",
    refId: idx,
  });

  await activateConsultationAfterPayment(payment.requestId.toString());
  return payment;
}

/** Dev-only: mark payment paid without gateway */
export async function devMarkPaymentPaid(paymentId: string) {
  if (process.env.ALLOW_DEV_PAYMENT !== "true") {
    throw new Error("Dev payment not enabled");
  }
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "paid") return payment;

  payment.status = "paid";
  payment.providerRef = "dev-mock";
  payment.paidAt = new Date();
  await payment.save();

  await logConsultationEvent(payment.requestId, "payment_paid", "system", undefined, {
    provider: payment.provider,
    dev: true,
  });

  await activateConsultationAfterPayment(payment.requestId.toString());
  return payment;
}
