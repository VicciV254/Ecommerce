import prisma from '../config/database.js';
import { generateSlug } from '../utils/helpers.js';
import { categorySchema } from '../utils/validators.js';

export const getAllCategories = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { order: 'asc' },
    });
    
    res.json(categories);
  } catch (error) {
    next(error);
  }
};

export const getCategoryById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        products: {
          where: { isActive: true },
          include: {
            stock: true,
            images: { orderBy: { order: 'asc' } },
          },
        },
      },
    });
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const validatedData = categorySchema.parse(req.body);
    
    const category = await prisma.category.create({
      data: {
        name: validatedData.name,
        slug: generateSlug(validatedData.name),
        headerImage: validatedData.headerImage,
        order: validatedData.order,
      },
    });
    
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const validatedData = categorySchema.parse(req.body);
    
    const category = await prisma.category.update({
      where: { id },
      data: {
        name: validatedData.name,
        slug: validatedData.name ? generateSlug(validatedData.name) : undefined,
        headerImage: validatedData.headerImage,
        order: validatedData.order,
      },
    });
    
    res.json(category);
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    await prisma.category.delete({
      where: { id },
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
