import prisma from '../config/database.js';
import { normalizePhone, queryStk, requestStkPush } from '../services/mpesaService.js';

export const initiateStkPush = async (req, res, next) => {
  try {
    const { phone, amount, orderNumber } = req.body;
    if (!phone || !amount) {
      return res.status(400).json({ error: 'Phone and amount are required' });
    }

    const response = await requestStkPush({
      phone,
      amount,
      accountReference: orderNumber || 'No Maneno',
      transactionDesc: `No Maneno Bazaar ${orderNumber || 'order'}`,
    });

    await prisma.mpesaPayment.create({
      data: {
        checkoutRequestId: response.CheckoutRequestID,
        merchantRequestId: response.MerchantRequestID,
        orderNumber,
        phone: normalizePhone(phone),
        amount: Number(amount),
        status: response.ResponseCode === '0' ? 'PENDING' : 'FAILED',
        resultDesc: response.ResponseDescription,
      },
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
};

export const mpesaCallback = async (req, res, next) => {
  try {
    const stk = req.body?.Body?.stkCallback;
    if (!stk?.CheckoutRequestID) {
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const receipt = stk.CallbackMetadata?.Item?.find((item) => item.Name === 'MpesaReceiptNumber')?.Value;

    const payment = await prisma.mpesaPayment.update({
      where: { checkoutRequestId: stk.CheckoutRequestID },
      data: {
        status: stk.ResultCode === 0 ? 'PAID' : 'FAILED',
        resultCode: stk.ResultCode,
        resultDesc: stk.ResultDesc,
        receiptNumber: receipt ? String(receipt) : null,
        rawCallback: req.body,
      },
    }).catch(() => undefined);

    if (payment?.orderNumber) {
      await prisma.order.update({
        where: { orderNumber: payment.orderNumber },
        data: {
          paymentStatus: stk.ResultCode === 0 ? 'PAID' : 'FAILED',
          status: stk.ResultCode === 0 ? 'PROCESSING' : 'PENDING',
          trackingHistory: {
            create: {
              status: stk.ResultCode === 0 ? 'PROCESSING' : 'PENDING',
              description: stk.ResultCode === 0
                ? `Payment confirmed by M-Pesa${receipt ? ` - receipt ${receipt}` : ''}`
                : `M-Pesa payment failed - ${stk.ResultDesc}`,
              location: 'M-Pesa Daraja callback',
            },
          },
        },
      }).catch(() => undefined);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    next(error);
  }
};

export const getPaymentStatus = async (req, res, next) => {
  try {
    const { checkoutRequestId } = req.params;
    const payment = await prisma.mpesaPayment.findUnique({ where: { checkoutRequestId } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    next(error);
  }
};

export const queryPaymentStatus = async (req, res, next) => {
  try {
    const { checkoutRequestId } = req.params;
    const response = await queryStk(checkoutRequestId);
    res.json(response);
  } catch (error) {
    next(error);
  }
};

