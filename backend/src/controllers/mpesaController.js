import {
  getPayment, ingestCallback, initiatePayment, orderPayments, paymentDto, reconcilePayment,
} from '../services/paymentService.js';

export const initiateStkPush = async (req, res, next) => {
  try {
    const result = await initiatePayment(req.user.id, req.body, req.get('Idempotency-Key'));
    res.status(result.created ? 201 : 200).json(result.payment);
  } catch (error) { next(error); }
};
export const mpesaCallback = async (req, res, next) => {
  try {
    await ingestCallback(req.params.id, req.params.key, req.body);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) { next(error); }
};
export const getOrderPayments = async (req, res, next) => {
  try { res.json(await orderPayments(req.params.orderId, req.user?.id, Boolean(req.admin))); }
  catch (error) { next(error); }
};
export const getPaymentStatus = async (req, res, next) => {
  try { res.json(paymentDto(await getPayment(req.params.id, req.user?.id, Boolean(req.admin)))); }
  catch (error) { next(error); }
};
export const queryPaymentStatus = async (req, res, next) => {
  try { res.json(await reconcilePayment(req.params.id, { userId: req.user?.id, staff: Boolean(req.admin) })); }
  catch (error) { next(error); }
};

export const paymentErrorHandler = (error, _req, res, _next) => {
  // Never pass provider/database errors to generic logging or expose request/credential data.
  const validation = error.name === 'ZodError';
  const status = validation ? 400 : error.statusCode ?? 503;
  console.error('M-Pesa operation failed', { code: validation ? 'PAYMENT_INPUT_INVALID' : error.code ?? 'PAYMENT_STORAGE_ERROR', status });
  res.status(status).json({
    code: validation ? 'PAYMENT_INPUT_INVALID' : error.statusCode ? error.code : 'PAYMENT_STORAGE_ERROR',
    error: validation ? 'Invalid payment request. Submit only the order ID, phone number and request key.' :
      error.statusCode ? error.message : 'Payment data could not be saved or loaded. Check this attempt again before sending another prompt.',
  });
};
