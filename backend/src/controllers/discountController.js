import prisma from '../config/database.js';
import { discountSchema } from '../utils/validators.js';

export const getAllDiscounts = async (req, res, next) => {
  try {
    const discounts = await prisma.discount.findMany({
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(discounts);
  } catch (error) {
    next(error);
  }
};

export const getActiveDiscounts = async (req, res, next) => {
  try {
    const now = new Date();
    
    const discounts = await prisma.discount.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        OR: [
          { endDate: null },
          { endDate: { gte: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(discounts);
  } catch (error) {
    next(error);
  }
};

export const createDiscount = async (req, res, next) => {
  try {
    const validatedData = discountSchema.parse(req.body);
    
    const discount = await prisma.discount.create({
      data: {
        name: validatedData.name,
        type: validatedData.type,
        value: validatedData.value,
        applyTo: validatedData.applyTo,
        targetIds: validatedData.targetIds || [],
        startDate: new Date(validatedData.startDate),
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : null,
        isActive: validatedData.isActive ?? true,
      },
    });
    
    res.status(201).json(discount);
  } catch (error) {
    next(error);
  }
};

export const updateDiscount = async (req, res, next) => {
  try {
    const { id } = req.params;
    const validatedData = discountSchema.parse(req.body);
    
    const discount = await prisma.discount.update({
      where: { id },
      data: {
        name: validatedData.name,
        type: validatedData.type,
        value: validatedData.value,
        applyTo: validatedData.applyTo,
        targetIds: validatedData.targetIds,
        startDate: new Date(validatedData.startDate),
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : null,
        isActive: validatedData.isActive,
      },
    });
    
    res.json(discount);
  } catch (error) {
    next(error);
  }
};

export const deleteDiscount = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    await prisma.discount.delete({
      where: { id },
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
