import { userSummarySelect } from './account.js';

export const orderInclude = {
  items: { orderBy: { id: 'asc' } },
  address: true,
  user: { select: userSummarySelect },
  trackingHistory: { orderBy: { createdAt: 'desc' } },
};

export function orderDto(order) {
  return { ...order, address: order.addressSnapshot ?? order.address };
}
