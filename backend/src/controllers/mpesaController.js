const paymentsUnavailable = (_req, res) => res.status(503).json({
  error: 'Payments are unavailable until the order-linked, verified payment lifecycle is implemented.',
});

export const initiateStkPush = paymentsUnavailable;
export const mpesaCallback = paymentsUnavailable;
export const getPaymentStatus = paymentsUnavailable;
export const queryPaymentStatus = paymentsUnavailable;
