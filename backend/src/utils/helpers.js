export const generateSlug = (text) => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const generateOrderNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `NM-${year}${month}-${random}`;
};

export const formatPrice = (price) => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
  }).format(price);
};

export const calculateDiscount = (price, discount) => {
  if (!discount || !discount.isActive) return 0;
  
  const now = new Date();
  const startDate = new Date(discount.startDate);
  const endDate = discount.endDate ? new Date(discount.endDate) : null;
  
  if (now < startDate || (endDate && now > endDate)) {
    return 0;
  }
  
  if (discount.type === 'PERCENTAGE') {
    return price * (discount.value / 100);
  } else {
    return discount.value;
  }
};

export const paginate = (page, limit) => {
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;
  
  return { skip, take: limitNum, page: pageNum };
};
