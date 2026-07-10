import api from "./client";

export type StkPushResponse = {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
};

export const mpesaAPI = {
  stkPush: (data: { phone: string; amount: number; orderNumber?: string }) =>
    api.post<StkPushResponse>("/mpesa/stk-push", data),
  getPayment: (checkoutRequestId: string) =>
    api.get(`/mpesa/payments/${checkoutRequestId}`),
  queryPayment: (checkoutRequestId: string) =>
    api.post(`/mpesa/payments/${checkoutRequestId}/query`),
};
