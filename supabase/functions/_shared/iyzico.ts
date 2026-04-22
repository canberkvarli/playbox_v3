/**
 * Minimal Iyzico client for Supabase Edge Functions (Deno).
 *
 * Uses the V2 (IYZWSv2) auth scheme:
 *   payload    = randomKey + uriPath + JSON.stringify(body)
 *   signature  = base64(HMAC-SHA256(payload, secretKey))
 *   authParams = "apiKey:<x>&randomKey:<y>&signature:<z>"
 *   Authorization: "IYZWSv2 " + base64(authParams)
 *
 * Env vars required on the Supabase project:
 *   IYZICO_API_KEY
 *   IYZICO_SECRET_KEY
 *   IYZICO_BASE_URL  (sandbox: https://sandbox-api.iyzipay.com | prod: https://api.iyzipay.com)
 */

const API_KEY = Deno.env.get('IYZICO_API_KEY') ?? '';
const SECRET_KEY = Deno.env.get('IYZICO_SECRET_KEY') ?? '';
const BASE_URL = Deno.env.get('IYZICO_BASE_URL') ?? 'https://sandbox-api.iyzipay.com';

export type IyzicoEnvOk = { ok: true };
export type IyzicoEnvMissing = { ok: false; missing: string[] };

export function checkEnv(): IyzicoEnvOk | IyzicoEnvMissing {
  const missing: string[] = [];
  if (!API_KEY) missing.push('IYZICO_API_KEY');
  if (!SECRET_KEY) missing.push('IYZICO_SECRET_KEY');
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

function randomKey(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

async function hmacSha256Base64(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function buildAuthHeader(uri: string, bodyString: string): Promise<{ auth: string; rnd: string }> {
  const rnd = randomKey();
  const signature = await hmacSha256Base64(SECRET_KEY, rnd + uri + bodyString);
  const authParams = `apiKey:${API_KEY}&randomKey:${rnd}&signature:${signature}`;
  const authHeader = 'IYZWSv2 ' + btoa(authParams);
  return { auth: authHeader, rnd };
}

export async function iyzicoPost<TReq, TRes>(uri: string, body: TReq): Promise<TRes> {
  const bodyString = JSON.stringify(body);
  const { auth, rnd } = await buildAuthHeader(uri, bodyString);
  const res = await fetch(BASE_URL + uri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
      'x-iyzi-rnd': rnd,
    },
    body: bodyString,
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as TRes;
  } catch {
    return { status: 'failure', errorMessage: `non-json: ${text.slice(0, 200)}` } as TRes;
  }
}

// ---------- Shared response shape Iyzico uses ----------

export type IyzicoBase = {
  status: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
  locale?: string;
  conversationId?: string;
};

// ---------- /cardstorage/card ----------

export type RegisterCardRequest = {
  locale: 'tr' | 'en';
  conversationId: string;
  externalId?: string;
  email: string;
  cardUserKey?: string;
  card: {
    cardAlias: string;
    cardNumber: string;
    expireYear: string;
    expireMonth: string;
    cardHolderName: string;
  };
};

export type RegisterCardResponse = IyzicoBase & {
  externalId?: string;
  email?: string;
  cardUserKey?: string;
  cardToken?: string;
  cardAlias?: string;
  binNumber?: string;
  lastFourDigits?: string;
  cardType?: string;
  cardAssociation?: string;
  cardFamily?: string;
  cardBankCode?: number;
  cardBankName?: string;
};

export function registerCard(req: RegisterCardRequest) {
  return iyzicoPost<RegisterCardRequest, RegisterCardResponse>('/cardstorage/card', req);
}

// ---------- /payment/preauth ----------

export type PreauthRequest = {
  locale: 'tr' | 'en';
  conversationId: string;
  price: string;
  paidPrice: string;
  currency: 'TRY';
  installment: 1;
  basketId: string;
  paymentChannel: 'MOBILE';
  paymentGroup: 'PRODUCT';
  paymentCard: {
    cardUserKey: string;
    cardToken: string;
  };
  buyer: {
    id: string;
    name: string;
    surname: string;
    gsmNumber?: string;
    email: string;
    identityNumber: string;
    registrationAddress: string;
    ip: string;
    city: string;
    country: string;
  };
  shippingAddress: { contactName: string; city: string; country: string; address: string };
  billingAddress: { contactName: string; city: string; country: string; address: string };
  basketItems: Array<{
    id: string;
    name: string;
    category1: string;
    itemType: 'VIRTUAL';
    price: string;
  }>;
};

export type PreauthResponse = IyzicoBase & {
  paymentId?: string;
  paymentTransactionId?: string;
  price?: number;
  paidPrice?: number;
  installment?: number;
  currency?: string;
  fraudStatus?: number;
};

export function preauth(req: PreauthRequest) {
  return iyzicoPost<PreauthRequest, PreauthResponse>('/payment/preauth', req);
}

// ---------- /payment/postauth (capture) ----------

export type PostauthRequest = {
  locale: 'tr' | 'en';
  conversationId: string;
  paymentId: string;
  paidPrice: string;
  ip: string;
  currency: 'TRY';
  installment: 1;
};

export type PostauthResponse = IyzicoBase & {
  paymentId?: string;
};

export function postauth(req: PostauthRequest) {
  return iyzicoPost<PostauthRequest, PostauthResponse>('/payment/postauth', req);
}

// ---------- /payment/cancel (release) ----------

export type CancelRequest = {
  locale: 'tr' | 'en';
  conversationId: string;
  paymentId: string;
  ip: string;
};

export type CancelResponse = IyzicoBase & {
  paymentId?: string;
};

export function cancel(req: CancelRequest) {
  return iyzicoPost<CancelRequest, CancelResponse>('/payment/cancel', req);
}

// ---------- Helpers ----------

export function prettyBrand(cardAssociation?: string): string {
  if (!cardAssociation) return 'KART';
  const map: Record<string, string> = {
    VISA: 'VISA',
    MASTER_CARD: 'MASTERCARD',
    AMERICAN_EXPRESS: 'AMEX',
    TROY: 'TROY',
  };
  return map[cardAssociation] ?? cardAssociation;
}
